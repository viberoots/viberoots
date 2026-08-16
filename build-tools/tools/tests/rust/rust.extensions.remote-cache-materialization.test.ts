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
import {
  artifactNixExperimentalFeatureArgs,
  REVIEWED_EVIDENCE_PUBLIC_KEY,
} from "../../lib/artifact-nix-policy";
import {
  buildSelectedOutPath,
  reconcileTempDependencyInputs,
  runInTemp,
} from "../lib/test-helpers";
import { resolvePinnedTestToolPath } from "../lib/test-helpers/pinned-tool";
import { writeRustExtensionRuntimeFixture } from "./rust-extension-runtime-fixture";
import { writePyO3PyodideApp } from "./rust-pyodide-pyo3-fixture";
import {
  assertPyodideValue,
  pyodideTarget,
  readPyodideAbi,
} from "./rust.extensions.remote-cache-materialization.fixture";

test("Rust extensions survive remote preparation and a credential-free binary cache handoff", async () => {
  await runInTemp("rust-extension-remote-cache", async (tmp, $) => {
    await writeRustExtensionRuntimeFixture(tmp);
    const { appDir } = await writePyO3PyodideApp(tmp);
    await fs.writeFile(path.join(appDir, "TARGETS"), pyodideTarget);
    await reconcileTempDependencyInputs(tmp, $);
    const targets = [
      "//projects/libs/rust_pyext:extension",
      "//projects/libs/rust_addon:addon",
      "//projects/apps/rust_pyodide_app:pyapp",
    ];
    const outputs: string[] = [];
    for (const target of targets) {
      outputs.push(await buildSelectedOutPath({ tmp, $, target }));
    }
    await assertPyodideValue(outputs[2]!, $);
    const selectedPyodideAbi = await readPyodideAbi(outputs[2]!);
    await fs.writeFile(path.join(appDir, "bin/__main__.py"), "raise SystemExit(99)\n");
    await fs.writeFile(
      path.join(appDir, "src/lib.rs"),
      'compile_error!("poisoned live source");\n',
    );
    await assertPyodideValue(outputs[2]!, $);
    const cache = path.join(tmp, "binary-cache");
    await fs.mkdir(cache, { recursive: true });
    const cacheUri = `file://${cache}?compression=none`;
    const artifactToolsRoot = canonicalArtifactToolsRoot(tmp);
    const nix = path.join(artifactToolsRoot, "bin/nix");
    const nixFeatures = artifactNixExperimentalFeatureArgs();
    const secretKey = path.join(tmp, "test-cache-secret-key");
    const secret = String(
      await $({
        cwd: tmp,
        stdio: "pipe",
      })`${nix} ${nixFeatures} key generate-secret --key-name viberoots-test-cache-1`,
    );
    await fs.writeFile(secretKey, secret, { mode: 0o600 });
    const testPublicKey = String(
      await $({
        cwd: tmp,
        input: secret,
        stdio: "pipe",
      })`${nix} ${nixFeatures} key convert-secret-to-public`,
    ).trim();
    const cachePaths = outputs;
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} ${nixFeatures} copy --to ${cacheUri} ${cachePaths}`;
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} ${nixFeatures} --store ${cacheUri} store sign --key-file ${secretKey} --recursive ${cachePaths}`;
    const generated = await Promise.all(
      outputs
        .slice(0, 2)
        .map(async (output) =>
          JSON.parse(
            await fs.readFile(
              path.join(output, "share/viberoots-rust/materialization-manifest.json"),
              "utf8",
            ),
          ),
        ),
    );
    const pyodideGenerated = JSON.parse(
      await fs.readFile(
        path.join(outputs[2]!, "share/viberoots-python-wasm/materialization-manifest.json"),
        "utf8",
      ),
    );
    assert.deepEqual(pyodideGenerated.evidence, {
      provenance: {
        path: "share/viberoots-python-wasm/provenance.json",
        schema: "viberoots.python-wasm-provenance.v1",
      },
      sbom: {
        path: "share/viberoots-python-wasm/sbom.spdx.json",
        format: "spdx-json",
      },
      pyemscriptenAbi: {
        path: "share/viberoots-python-wasm/pyemscripten-abi.json",
      },
    });
    const reviewedEndpoint = "https://cache.home.kilty.io/main";
    assert.deepEqual(generated[0].substituter, {
      trustedPublicKeys: [REVIEWED_EVIDENCE_PUBLIC_KEY],
      endpointIdentity: reviewedEndpoint,
    });
    assert.deepEqual(pyodideGenerated.substituter, generated[0].substituter);
    const nativeManifest = parseMaterializationManifest({
      ...generated[0],
      storePaths: [...generated.flatMap((entry) => entry.storePaths)],
    });
    const pyodideManifest = parseMaterializationManifest(pyodideGenerated);
    assert.deepEqual(
      nativeManifest.storePaths.map((entry) => entry.path),
      outputs.slice(0, 2),
    );
    assert.deepEqual(
      pyodideManifest.storePaths.map((entry) => entry.path),
      [outputs[2]],
    );
    const coldStore = path.join(tmp, "cold-nix-store");
    const coldUri = `local?root=${coldStore}`;
    for (const output of cachePaths) {
      const coldProbe = await $({
        cwd: tmp,
        stdio: "pipe",
        nothrow: true,
      })`${nix} ${nixFeatures} --store ${coldUri} path-info ${output}`;
      assert.notEqual(coldProbe.exitCode, 0, `cold store unexpectedly contained ${output}`);
    }
    const nativeReports = await materializeNixStorePaths({
      manifest: nativeManifest,
      artifactToolsRoot,
      runner: async (command) => {
        const [executable, ...args] = command.map((part) => {
          if (part === reviewedEndpoint) return cacheUri;
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
    const pyodideReports = await materializeNixStorePaths({
      manifest: pyodideManifest,
      artifactToolsRoot,
      runner: async (command) => {
        const [executable, ...args] = command.map((part) => {
          if (part === reviewedEndpoint) return cacheUri;
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
    const reports = [...nativeReports, ...pyodideReports];
    assert.deepEqual(
      reports.map(({ path: output }) => output),
      cachePaths,
    );
    assert.ok(reports.every((report) => report.cache === "hit"));
    assert.ok(reports.every((report) => report.command.includes(reviewedEndpoint)));
    const pyodideColdImport = `${coldStore}${outputs[2]}`;
    await assertPyodideValue(pyodideColdImport, $);
    assert.deepEqual(await readPyodideAbi(pyodideColdImport), selectedPyodideAbi);
    const physical = outputs.map((output) => `${coldStore}${output}`);
    const isolatedPy = path.join(tmp, "isolated-runtime/python");
    const isolatedNode = path.join(tmp, "isolated-runtime/node");
    await fs.cp(path.join(physical[0], "site"), isolatedPy, { recursive: true });
    await fs.cp(path.join(physical[1], "lib"), isolatedNode, { recursive: true });
    assert.ok((await fs.readdir(path.join(isolatedNode, "runtime"))).length >= 2);
    const pyExtension = path.join(
      isolatedPy,
      "demo",
      (await fs.readdir(path.join(isolatedPy, "demo"))).find((file) => file.startsWith("_native"))!,
    );
    const addon = path.join(isolatedNode, "rust_native.node");
    const readelf =
      process.platform === "darwin" ? null : await resolvePinnedTestToolPath("readelf", $);
    for (const binary of [pyExtension, addon]) {
      const dependencyReport =
        process.platform === "darwin"
          ? await $({ cwd: tmp, stdio: "pipe" })`/usr/bin/otool -L ${binary}`
          : await $({ cwd: tmp, stdio: "pipe" })`${readelf!} -d ${binary}`;
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
    })`${process.execPath} -e "require(process.argv[1]).answer()" ${noRuntimeAddon}`;
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
