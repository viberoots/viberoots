#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
} from "../../remote-exec/nix-store-materialize";
import { REVIEWED_EVIDENCE_PUBLIC_KEY } from "../../lib/artifact-nix-policy";
import {
  buildSelectedOutPath,
  reconcileTempDependencyInputs,
  runInTemp,
} from "../lib/test-helpers";
import { writeRustExtensionRuntimeFixture } from "./rust-extension-runtime-fixture";

test("Rust extensions survive remote preparation and a credential-free binary cache handoff", async () => {
  await runInTemp("rust-extension-remote-cache", async (tmp, $) => {
    await writeRustExtensionRuntimeFixture(tmp);
    await reconcileTempDependencyInputs(tmp, $);
    const targets = ["//projects/libs/rust_pyext:extension", "//projects/libs/rust_addon:addon"];
    const outputs: string[] = [];
    for (const target of targets) {
      outputs.push(await buildSelectedOutPath({ tmp, $, target }));
    }
    const cache = path.join(tmp, "binary-cache");
    await fs.mkdir(cache, { recursive: true });
    const artifactToolsRoot = canonicalArtifactToolsRoot(tmp);
    const nix = path.join(artifactToolsRoot, "bin/nix");
    const secretKey = path.join(tmp, "test-cache-secret-key");
    const secret = String(
      await $({
        cwd: tmp,
        stdio: "pipe",
      })`${nix} key generate-secret --key-name viberoots-test-cache-1`,
    );
    await fs.writeFile(secretKey, secret, { mode: 0o600 });
    const testPublicKey = String(
      await $({
        cwd: tmp,
        input: secret,
        stdio: "pipe",
      })`${nix} key convert-secret-to-public`,
    ).trim();
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} copy --to ${`file://${cache}`} ${outputs}`;
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} --store ${`file://${cache}`} store sign --key-file ${secretKey} --recursive ${outputs}`;
    const generated = await Promise.all(
      outputs.map(async (output) =>
        JSON.parse(
          await fs.readFile(
            path.join(output, "share/viberoots-rust/materialization-manifest.json"),
            "utf8",
          ),
        ),
      ),
    );
    const reviewedEndpoint = "https://cache.home.kilty.io/main";
    assert.deepEqual(generated[0].substituter, {
      trustedPublicKeys: [REVIEWED_EVIDENCE_PUBLIC_KEY],
      endpointIdentity: reviewedEndpoint,
    });
    const manifest = parseMaterializationManifest({
      ...generated[0],
      storePaths: generated.flatMap((entry) => entry.storePaths),
    });
    assert.deepEqual(
      manifest.storePaths.map((entry) => entry.path),
      outputs,
    );
    const coldStore = path.join(tmp, "cold-nix-store");
    const coldUri = `local?root=${coldStore}`;
    for (const output of outputs) {
      const coldProbe = await $({
        cwd: tmp,
        stdio: "pipe",
        nothrow: true,
      })`${nix} --store ${coldUri} path-info ${output}`;
      assert.notEqual(coldProbe.exitCode, 0, `cold store unexpectedly contained ${output}`);
    }
    const reports = await materializeNixStorePaths({
      manifest,
      artifactToolsRoot,
      runner: async (command) => {
        const [executable, ...args] = command.map((part) => {
          if (part === reviewedEndpoint) return `file://${cache}`;
          if (part.includes(REVIEWED_EVIDENCE_PUBLIC_KEY)) {
            return part.replace(REVIEWED_EVIDENCE_PUBLIC_KEY, testPublicKey);
          }
          return part;
        });
        const result = await $({
          cwd: tmp,
          stdio: "pipe",
        })`${executable!} --store ${coldUri} ${args}`;
        return { stdout: String(result.stdout), stderr: String(result.stderr) };
      },
    });
    assert.deepEqual(
      reports.map(({ path: output }) => output),
      outputs,
    );
    assert.ok(reports.every((report) => report.cache === "hit"));
    assert.ok(reports.every((report) => report.command.includes(reviewedEndpoint)));
    const physical = outputs.map((output) => `${coldStore}${output}`);
    const isolatedPy = path.join(tmp, "isolated-runtime/python");
    const isolatedNode = path.join(tmp, "isolated-runtime/node");
    await fs.cp(path.join(physical[0], "site"), isolatedPy, { recursive: true });
    await fs.cp(path.join(physical[1], "lib"), isolatedNode, { recursive: true });
    const pyExtension = path.join(
      isolatedPy,
      "demo",
      (await fs.readdir(path.join(isolatedPy, "demo"))).find((file) => file.startsWith("_native"))!,
    );
    const addon = path.join(isolatedNode, "rust_native.node");
    for (const binary of [pyExtension, addon]) {
      const dependencyReport =
        process.platform === "darwin"
          ? await $({ cwd: tmp, stdio: "pipe" })`/usr/bin/otool -L ${binary}`
          : await $({ cwd: tmp, stdio: "pipe" })`readelf -d ${binary}`;
      assert.doesNotMatch(
        String(dependencyReport.stdout),
        /\/nix\/store\/.*extension-(?:base|c)/,
        `isolated extension retained a warm-store fixture dependency: ${binary}`,
      );
    }
    const python = path.join(artifactToolsRoot, "bin/python3");
    const pyProbe = await $({
      cwd: tmp,
      env: {
        ...process.env,
        PYTHONPATH: isolatedPy,
        PYTHONNOUSERSITE: "1",
      },
      stdio: "pipe",
    })`${python} -c "import demo._native as native; assert native.answer() == 42"`;
    assert.equal(pyProbe.exitCode, 0);
    const nodeProbe = await $({ cwd: tmp, stdio: "pipe" })`${process.execPath} -e ${[
      "const addon = require(process.argv[1])",
      "if (addon.answer() !== 42) process.exit(2)",
      "if (addon.napiVersion() !== 8) process.exit(3)",
    ].join("; ")} ${addon}`;
    assert.equal(nodeProbe.exitCode, 0);
    const noRuntimeDir = path.join(tmp, "isolated-runtime/no-runtime");
    await fs.mkdir(noRuntimeDir);
    const noRuntimeAddon = path.join(noRuntimeDir, "rust_native.node");
    await fs.copyFile(addon, noRuntimeAddon);
    const noFallback = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`${process.execPath} -e "require(process.argv[1])" ${noRuntimeAddon}`;
    assert.notEqual(
      noFallback.exitCode,
      0,
      "addon unexpectedly fell back to a warm host-store runtime dependency",
    );
    const restoredProbe = await $({
      cwd: tmp,
      stdio: "pipe",
    })`${process.execPath} -e "if (require(process.argv[1]).answer() !== 42) process.exit(2)" ${addon}`;
    assert.equal(restoredProbe.exitCode, 0);
  });
});
