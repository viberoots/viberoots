#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { admitKubernetesComponentArtifacts } from "../../deployments/kubernetes-artifacts";
import { artifactIdentityForNodeServiceDir } from "../../node/service-artifact";
import {
  buildSelectedOutPath,
  exportGraphInTemp,
  reconcileTempDependencyInputs,
  runBuildSelected,
  runInTemp,
} from "../lib/test-helpers";
import { writeRustExtensionRuntimeFixture } from "./rust-extension-runtime-fixture";
import { assertNativeAddonRuntimeCollisionBehavior } from "./native-addon-runtime-collision-fixture";

async function writePackage(
  tmp: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const root = path.join(tmp, "projects/apps", name);
  files["pnpm-lock.yaml"] = "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n";
  await Promise.all(
    Object.entries(files).map(async ([relative, contents]) => {
      const destination = path.join(root, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, contents);
    }),
  );
}

test("Node CLI, service, and webapp stage a transitive Rust addon", async () => {
  await runInTemp("rust-addon-node-consumers", async (tmp, $) => {
    await writeRustExtensionRuntimeFixture(tmp);
    const packageJson = (name: string) =>
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        devDependencies: { typescript: "5.9.2", vite: "7.1.5" },
      });
    await writePackage(tmp, "native-cli", {
      "package.json": packageJson("native-cli"),
      "src/index.ts": [
        'import { createRequire } from "node:module";',
        'const addon = createRequire(import.meta.url)("./native/rust_native.node");',
        "console.log(addon.answer());",
        "",
      ].join("\n"),
      TARGETS: [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        'nix_node_cli_bin(name="cli", bundle=True,',
        '  deps=["//projects/libs/rust_addon:addon"])',
        "",
      ].join("\n"),
    });
    await writePackage(tmp, "native-web", {
      "package.json": packageJson("native-web"),
      "index.html": '<main id="app"></main><script type="module" src="/src.ts"></script>\n',
      "src.ts": 'document.querySelector("#app")!.textContent = "native web";\n',
      TARGETS: [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        'node_webapp(name="web", labels=["webapp:static", "framework:vite"],',
        '  deps=["//projects/libs/rust_addon:addon"])',
        "",
      ].join("\n"),
    });
    await writePackage(tmp, "native-service", {
      "package.json": packageJson("native-service"),
      "src/index.ts": [
        'declare const process: { getBuiltinModule(name: "module"): { createRequire(url: string): (path: string) => { answer(): number } } };',
        'const addon = process.getBuiltinModule("module").createRequire(import.meta.url)("./native/rust_native.node");',
        "console.log(addon.answer());",
        "",
      ].join("\n"),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          target: "ES2022",
        },
        include: ["src/**/*.ts"],
      }),
      "service.runtime.json": JSON.stringify({
        schemaVersion: "node-service-runtime@1",
        serviceName: "native-service",
        entrypoint: "index.js",
        productionCommand: ["node", "dist/index.js"],
        health: { path: "/healthz", port: 3000 },
        runtimeConfig: [],
        secretRequirements: [],
      }),
      TARGETS: [
        'load("@viberoots//build-tools/node:defs.bzl", "node_service_artifact")',
        'node_service_artifact(name="service",',
        '  deps=["//projects/libs/rust_addon:addon"])',
        "",
      ].join("\n"),
    });
    await reconcileTempDependencyInputs(tmp, $);
    await assertNativeAddonRuntimeCollisionBehavior(tmp, $);
    const outputs = await Promise.all([
      buildSelectedOutPath({
        tmp,
        $,
        target: "//projects/apps/native-cli:cli",
      }),
      buildSelectedOutPath({
        tmp,
        $,
        target: "//projects/apps/native-web:web",
      }),
      buildSelectedOutPath({
        tmp,
        $,
        target: "//projects/apps/native-service:service",
      }),
    ]);
    const addons = [
      path.join(outputs[0], "bin/native/rust_native.node"),
      path.join(outputs[1], "dist/native/rust_native.node"),
      path.join(outputs[2], "native/rust_native.node"),
    ];
    for (const addon of addons) {
      assert.ok((await fs.stat(addon)).size > 0, `missing staged addon: ${addon}`);
      assert.ok(
        (await fs.readdir(path.join(path.dirname(addon), "runtime"))).length > 0,
        `missing staged runtime closure: ${addon}`,
      );
      const probe = await $({ cwd: tmp, stdio: "pipe" })`${process.execPath} -e ${[
        "const addon = require(process.argv[1])",
        "if (addon.answer() !== 42) process.exit(2)",
      ].join("; ")} ${addon}`;
      assert.equal(probe.exitCode, 0);
    }
    const cliProbe = await $({ cwd: tmp, stdio: "pipe" })`${path.join(outputs[0], "bin/cli")}`;
    assert.equal(String(cliProbe.stdout).trim(), "42");
    const serviceProbe = await $({
      cwd: tmp,
      stdio: "pipe",
    })`${process.execPath} ${path.join(outputs[2], "dist/index.js")}`;
    assert.equal(String(serviceProbe.stdout).trim(), "42");
    await fs.access(path.join(outputs[2], "runtime-contract.json"));
    await fs.access(path.join(outputs[2], "artifact-identity.json"));
    await fs.access(path.join(outputs[2], "dist/native/rust_native.node"));
    const identityRecord = JSON.parse(
      await fs.readFile(path.join(outputs[2], "artifact-identity.json"), "utf8"),
    );
    const identityRoot = path.join(tmp, "service-identity-probe");
    await fs.cp(path.join(outputs[2], "dist"), path.join(identityRoot, "dist"), {
      recursive: true,
    });
    await fs.copyFile(
      path.join(outputs[2], "package.json"),
      path.join(identityRoot, "package.json"),
    );
    await fs.copyFile(
      path.join(outputs[2], "runtime-contract.json"),
      path.join(identityRoot, "runtime-contract.json"),
    );
    assert.equal(await artifactIdentityForNodeServiceDir(identityRoot), identityRecord.identity);
    const copiedAddon = path.join(identityRoot, "dist/native/rust_native.node");
    await fs.chmod(path.dirname(copiedAddon), 0o755);
    await fs.chmod(copiedAddon, 0o644);
    await fs.rm(copiedAddon);
    assert.notEqual(await artifactIdentityForNodeServiceDir(identityRoot), identityRecord.identity);
    const admitted = await admitKubernetesComponentArtifacts({
      recordsRoot: path.join(tmp, "deployment-records"),
      artifactPathsByComponentId: { service: outputs[2] },
    });
    assert.equal(admitted[0]?.sourceKind, "directory");
    await fs.access(path.join(admitted[0]!.storedArtifactPath, "dist/native/rust_native.node"));
    assert.ok(
      (await fs.readdir(path.join(admitted[0]!.storedArtifactPath, "dist/native/runtime"))).length >
        0,
    );

    await fs.appendFile(
      path.join(tmp, "projects/libs/rust_addon/TARGETS"),
      'rust_node_addon(name="addon_duplicate", addon_name="rust_native", node_api_version=8, crate="rust_addon", srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], visibility=["PUBLIC"])\n',
    );
    await fs.writeFile(
      path.join(tmp, "projects/apps/native-cli/TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        'nix_node_cli_bin(name="cli", bundle=True, deps=[',
        '  "//projects/libs/rust_addon:addon",',
        '  "//projects/libs/rust_addon:addon_duplicate",',
        "])",
        "",
      ].join("\n"),
    );
    await exportGraphInTemp({ tmp, $, stdio: "pipe" });
    const duplicate = await runBuildSelected({
      tmp,
      $,
      target: "//projects/apps/native-cli:cli",
      stdio: "pipe",
    });
    assert.notEqual(duplicate.exitCode, 0);
    assert.match(
      `${String(duplicate.stdout || "")}\n${String(duplicate.stderr || "")}`,
      /requires unique stable addon names/,
    );
  });
});
