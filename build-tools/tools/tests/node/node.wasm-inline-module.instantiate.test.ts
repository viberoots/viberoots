#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  publicBuildOutPath,
  reconcileTempDependencyInputs,
  runInTemp,
  runPublicBuild,
} from "../lib/test-helpers";
import { stageTempRepoPaths } from "../lib/test-helpers/git-stage";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function instantiateFromBytes(bytes: Uint8Array): Promise<WebAssembly.Instance> {
  const module = new WebAssembly.Module(bytes);
  const imports: Record<string, any> = {};
  const env: Record<string, any> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    if (imp.kind === "function") env[imp.name] = () => 0;
    else if (imp.kind === "global")
      env[imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    else if (imp.kind === "memory") env[imp.name] = new WebAssembly.Memory({ initial: 256 });
    else if (imp.kind === "table")
      env[imp.name] = new WebAssembly.Table({ initial: 0, element: "funcref" });
  }
  if (Object.keys(env).length) imports.env = env;
  try {
    const instance = await WebAssembly.instantiate(module, imports);
    return instance;
  } catch {
    const { WASI } = await import("node:wasi");
    const wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {} });
    const instance = await WebAssembly.instantiate(module, {
      ...imports,
      wasi_snapshot_preview1: wasi.wasiImport,
    } as any);
    if (typeof wasi.start === "function") wasi.start(instance);
    return instance;
  }
}

test(
  "node_wasm_inline_module: generates module that instantiates wasm",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS = "viberoots";
    }
    try {
      await runInTemp("node-wasm-inline-module", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "inherit" });
        const repoRoot = process.cwd();
        const flakeNix = path.join(repoRoot, "flake.nix");
        if (await fs.pathExists(flakeNix)) {
          await fs.copyFile(flakeNix, path.join(tmp, "flake.nix"));
        }
        const wasmDir = path.join(tmp, "projects", "libs", "demo-wasm");
        await fs.mkdirp(wasmDir);
        await fs.outputFile(
          path.join(wasmDir, "go.mod"),
          `module example.com/demo/wasm

go 1.22.0
`,
        );
        await fs.outputFile(
          path.join(wasmDir, "main.go"),
          `package main

//export add
func add(a int32, b int32) int32 {
  return a + b
}

func main() {}
`,
        );
        await fs.outputFile(
          path.join(wasmDir, "TARGETS"),
          `load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    visibility = ["PUBLIC"],
)
`,
        );

        const inlineDir = path.join(tmp, "projects", "libs", "demo-wasm-inline");
        await fs.mkdirp(inlineDir);
        await fs.outputFile(
          path.join(inlineDir, "package.json"),
          `{
  "name": "@libs/demo-wasm-inline",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "exports": {
    ".": "./index.js"
  },
  "dependencies": {
    "ansi-regex": "5.0.1"
  }
}
`,
        );
        await fs.outputFile(path.join(inlineDir, ".npmrc"), "node-linker=isolated\n");
        await fs.outputFile(path.join(inlineDir, ".pnpmfile.mjs"), "export default {};\n");
        await fs.outputFile(
          path.join(inlineDir, "pnpm-lock.yaml"),
          `lockfileVersion: "9.0"

importers:
  projects/libs/demo-wasm-inline:
    dependencies:
      ansi-regex:
        specifier: 5.0.1
        version: 5.0.1

packages:
  ansi-regex@5.0.1:
    resolution:
      integrity: sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==
    engines: { node: ">=8" }

snapshots:
  ansi-regex@5.0.1: {}
`,
        );
        await fs.outputFile(
          path.join(inlineDir, "TARGETS"),
          `load("@viberoots//build-tools/node:defs.bzl", "node_wasm_inline_module")

node_wasm_inline_module(
    name = "wasm_inline",
    visibility = ["PUBLIC"],
    src = "//projects/libs/demo-wasm:wasm",
)
`,
        );
        await fs.outputFile(
          path.join(tmp, "pnpm-workspace.yaml"),
          "packages:\n  - projects/apps/*\n  - projects/libs/*\n",
        );
        await stageTempRepoPaths({
          tmp,
          _$,
          recursiveRoots: ["projects/libs/demo-wasm", "projects/libs/demo-wasm-inline"],
          explicitPaths: ["pnpm-workspace.yaml"],
        });

        const inlineTarget = "//projects/libs/demo-wasm-inline:wasm_inline";
        const staleInlineBuild = await runPublicBuild({
          tmp,
          $,
          target: inlineTarget,
          reject: false,
        });
        assert.notEqual(
          staleInlineBuild.exitCode,
          0,
          "b must fail closed before inline importer reconciliation",
        );
        assert.match(
          String(staleInlineBuild.stderr || staleInlineBuild.stdout || ""),
          /repair: run u/,
        );
        await reconcileTempDependencyInputs(tmp, _$);
        await stageTempRepoPaths({
          tmp,
          _$,
          explicitPaths: ["projects/config/node-modules.hashes.json"],
        });
        const outputFile = await publicBuildOutPath({
          tmp,
          $,
          target: inlineTarget,
          wasmBackend: "wasi_single",
        });
        await fs.copy(outputFile, path.join(inlineDir, "index.js"));
        const mod = await import(pathToFileURL(outputFile).href);
        assert.equal(typeof mod.wasmBytes, "function");
        const bytes = mod.wasmBytes();
        const sourceFile = await publicBuildOutPath({
          tmp,
          $,
          target: "//projects/libs/demo-wasm:wasm",
          wasmBackend: "wasi_single",
        });
        const sourceBytes = await fs.readFile(sourceFile);
        assert.deepEqual(
          Array.from(bytes),
          Array.from(sourceBytes),
          "expected generated inline module bytes to match the source wasm artifact",
        );
        const instance = await instantiateFromBytes(bytes);
        const exp = instance.exports as Record<string, any>;
        assert.equal(exp.add(2, 3), 5);

        const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
        const hashesPath = path.join(tmp, "projects", "config", "node-modules.hashes.json");
        const graphBeforeHashChange = await fs.readFile(graphPath);
        const hashesBeforeHashChange = await fs.readFile(hashesPath);
        const inlinePackagePath = path.join(inlineDir, "package.json");
        const inlinePackage = await fs.readFile(inlinePackagePath, "utf8");
        await fs.writeFile(inlinePackagePath, inlinePackage.replace('"5.0.1"', '"6.2.0"'));
        const inlineLockPath = path.join(inlineDir, "pnpm-lock.yaml");
        const inlineLock = await fs.readFile(inlineLockPath, "utf8");
        await fs.writeFile(
          inlineLockPath,
          inlineLock
            .replaceAll("5.0.1", "6.2.0")
            .replace(
              "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
              "sha512-TKY5pyBkHyADOPYlRT9Lx6F544mPl0vS5Ew7BJ45hA08Q+t3GjbueLliBWN3sMICk6+y7HdyxSzC4bWS8baBdg==",
            )
            .replace('node: ">=8"', 'node: ">=12"'),
        );
        await stageTempRepoPaths({
          tmp,
          _$,
          explicitPaths: [
            "projects/libs/demo-wasm-inline/package.json",
            "projects/libs/demo-wasm-inline/pnpm-lock.yaml",
          ],
        });
        const staleHashBuild = await runPublicBuild({
          tmp,
          $,
          target: inlineTarget,
          reject: false,
        });
        assert.notEqual(staleHashBuild.exitCode, 0, "b must fail closed for a stale importer hash");
        assert.match(String(staleHashBuild.stderr || staleHashBuild.stdout || ""), /repair: run u/);
        assert.deepEqual(
          await fs.readFile(graphPath),
          graphBeforeHashChange,
          "stale b must not rewrite graph bytes",
        );
        await reconcileTempDependencyInputs(tmp, _$);
        await stageTempRepoPaths({
          tmp,
          _$,
          explicitPaths: ["projects/config/node-modules.hashes.json"],
        });
        assert.notDeepEqual(
          await fs.readFile(hashesPath),
          hashesBeforeHashChange,
          "u must reconcile the changed importer hash",
        );
        assert.notDeepEqual(
          await fs.readFile(graphPath),
          graphBeforeHashChange,
          "u must refresh graph bytes for a content-addressed hash identity change",
        );
        await publicBuildOutPath({
          tmp,
          $,
          target: inlineTarget,
          wasmBackend: "wasi_single",
        });

        const cliDir = path.join(tmp, "projects", "apps", "demo-cli");
        await fs.mkdirp(path.join(cliDir, "src"));
        await fs.outputFile(
          path.join(cliDir, "package.json"),
          `{
  "name": "@apps/demo-cli",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "dependencies": {
    "@libs/demo-wasm-inline": "workspace:*"
  }
}
`,
        );
        await fs.outputFile(path.join(cliDir, ".npmrc"), "node-linker=isolated\n");
        await fs.outputFile(path.join(cliDir, ".pnpmfile.mjs"), "export default {};\n");
        await fs.outputFile(
          path.join(cliDir, "pnpm-lock.yaml"),
          `lockfileVersion: "9.0"

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
      "@libs/demo-wasm-inline":
        specifier: workspace:*
        version: link:../../libs/demo-wasm-inline

packages: {}
`,
        );
        await fs.outputFile(
          path.join(cliDir, "src", "index.ts"),
          `import { wasmBytes } from "@libs/demo-wasm-inline";

async function instantiate() {
  const bytes = wasmBytes();
  const module = new WebAssembly.Module(bytes);
  const imports: Record<string, any> = {};
  const env: Record<string, any> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    if (imp.kind === "function") env[imp.name] = () => 0;
    else if (imp.kind === "global")
      env[imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    else if (imp.kind === "memory") env[imp.name] = new WebAssembly.Memory({ initial: 256 });
    else if (imp.kind === "table")
      env[imp.name] = new WebAssembly.Table({ initial: 0, element: "funcref" });
  }
  if (Object.keys(env).length) imports.env = env;
  try {
    return await WebAssembly.instantiate(module, imports);
  } catch {
    const { WASI } = await import("node:wasi");
    const wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {} });
    const instance = await WebAssembly.instantiate(module, {
      ...imports,
      wasi_snapshot_preview1: wasi.wasiImport,
    } as any);
    if (typeof wasi.start === "function") wasi.start(instance);
    return { instance };
  }
}

const { instance: cliInstance } = await instantiate();
const cliExports = cliInstance.exports as Record<string, any>;
console.log("add=" + cliExports.add(2, 3));
`,
        );
        await fs.outputFile(
          path.join(cliDir, "TARGETS"),
          `load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")

nix_node_cli_bin(
    name = "demo_cli",
    bundle = True,
    deps = ["//projects/libs/demo-wasm-inline:wasm_inline"],
)
`,
        );
        await stageTempRepoPaths({
          tmp,
          _$,
          recursiveRoots: [
            "projects/apps/demo-cli",
            "projects/libs/demo-wasm",
            "projects/libs/demo-wasm-inline",
          ],
          explicitPaths: ["pnpm-workspace.yaml", "projects/config/node-modules.hashes.json"],
        });
        const cliTarget = "//projects/apps/demo-cli:demo_cli";
        const staleCliBuild = await runPublicBuild({ tmp, $, target: cliTarget, reject: false });
        assert.notEqual(
          staleCliBuild.exitCode,
          0,
          "b must fail closed after adding an unreconciled importer",
        );
        assert.match(String(staleCliBuild.stderr || staleCliBuild.stdout || ""), /repair: run u/);
        await reconcileTempDependencyInputs(tmp, _$);
        await stageTempRepoPaths({
          tmp,
          _$,
          explicitPaths: ["projects/config/node-modules.hashes.json"],
        });
        const cliOutput = await publicBuildOutPath({
          tmp,
          $,
          target: cliTarget,
          wasmBackend: "wasi_single",
        });
        const runDir = path.join(tmp, "tmp-run");
        await fs.mkdirp(runDir);
        const runBin = path.join(runDir, "demo-cli");
        await fs.copyFile(cliOutput, runBin);
        await fs.chmod(runBin, 0o755);
        const run = await $({ cwd: runDir, stdio: "pipe" })`${runBin}`;
        assert.match(String(run.stdout || ""), /add=5/);
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
