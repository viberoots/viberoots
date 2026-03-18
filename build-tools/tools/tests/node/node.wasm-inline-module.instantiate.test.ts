#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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
      process.env.TEST_RSYNC_ROOTS =
        "build-tools toolchains third_party/providers prelude patches flake.nix flake.lock";
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
          `load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")

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
  }
}
`,
        );
        await fs.outputFile(path.join(inlineDir, ".npmrc"), "node-linker=isolated\n");
        await fs.outputFile(
          path.join(inlineDir, "pnpm-lock.yaml"),
          `lockfileVersion: "9.0"

importers:
  projects/libs/demo-wasm-inline:
    dependencies: {}

packages: {}
`,
        );
        await fs.outputFile(
          path.join(inlineDir, "TARGETS"),
          `load("//build-tools/node:defs.bzl", "node_wasm_inline_module")

node_wasm_inline_module(
    name = "wasm_inline",
    visibility = ["PUBLIC"],
    src = "//projects/libs/demo-wasm:wasm",
)
`,
        );
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

        const build = await $({
          cwd: tmp,
          stdio: "pipe",
          env: { ...process.env, WEB_WASM_BACKEND: "wasi_single" },
        })`buck2 build --target-platforms prelude//platforms:default --show-output //projects/libs/demo-wasm-inline:wasm_inline`;
        const outText = String(build.stdout || build.stderr || "").trim();
        const outLine = outText.split(/\n+/).pop() || "";
        const outPath = outLine.split(/\s+/).pop() || "";
        if (!outPath) throw new Error("no output file from buck2 build for wasm_inline");
        const outputFile = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
        await fs.copy(outputFile, path.join(inlineDir, "index.js"));
        const mod = await import(pathToFileURL(outputFile).href);
        assert.equal(typeof mod.wasmBytes, "function");
        const bytes = mod.wasmBytes();
        const sourceBuild = await $({
          cwd: tmp,
          stdio: "pipe",
          env: { ...process.env, WEB_WASM_BACKEND: "wasi_single" },
        })`buck2 build --target-platforms prelude//platforms:default --show-output //projects/libs/demo-wasm:wasm`;
        const sourceOutText = String(sourceBuild.stdout || sourceBuild.stderr || "").trim();
        const sourceOutLine = sourceOutText.split(/\n+/).pop() || "";
        const sourceOutPath = sourceOutLine.split(/\s+/).pop() || "";
        if (!sourceOutPath) throw new Error("no output file from buck2 build for wasm source");
        const sourceFile = path.isAbsolute(sourceOutPath)
          ? sourceOutPath
          : path.join(tmp, sourceOutPath);
        const sourceBytes = await fs.readFile(sourceFile);
        assert.deepEqual(
          Array.from(bytes),
          Array.from(sourceBytes),
          "expected generated inline module bytes to match the source wasm artifact",
        );
        const instance = await instantiateFromBytes(bytes);
        const exp = instance.exports as Record<string, any>;
        assert.equal(exp.add(2, 3), 5);

        await fs.outputFile(
          path.join(tmp, "pnpm-workspace.yaml"),
          "packages:\n  - projects/apps/*\n  - projects/libs/*\n",
        );

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
          `load("//build-tools/node:defs.bzl", "nix_node_cli_bin")

nix_node_cli_bin(
    name = "demo_cli",
    bundle = True,
    deps = ["//projects/libs/demo-wasm-inline:wasm_inline"],
)
`,
        );
        await $({
          cwd: cliDir,
          stdio: "inherit",
        })`pnpm install --lockfile-only --ignore-scripts --dir . --lockfile-dir .`;
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`node build-tools/tools/dev/update-pnpm-hash.ts --lockfile projects/apps/demo-cli/pnpm-lock.yaml`;
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`git add build-tools/tools/nix/node-modules.hashes.json`;

        const cliBuild = await $({
          cwd: tmp,
          stdio: "pipe",
          env: { ...process.env, WEB_WASM_BACKEND: "wasi_single" },
        })`buck2 build --target-platforms prelude//platforms:default --show-output //projects/apps/demo-cli:demo_cli`;
        const cliOutText = String(cliBuild.stdout || cliBuild.stderr || "").trim();
        const cliLine = cliOutText.split(/\n+/).pop() || "";
        const cliOutPath = cliLine.split(/\s+/).pop() || "";
        if (!cliOutPath) throw new Error("no output file from buck2 build for demo_cli");
        const cliOutput = path.isAbsolute(cliOutPath) ? cliOutPath : path.join(tmp, cliOutPath);
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
