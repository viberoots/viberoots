#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node_asset_stage: webapp output stages tinygo wasm",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
    }
    try {
      await runInTemp("node-asset-stage-webapp", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "inherit" });
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

        await $`scaf new node webapp demo-web --yes`;
        const appDir = path.join(tmp, "projects", "apps", "demo-web");
        await fs.outputFile(
          path.join(appDir, "TARGETS"),
          `load("//build-tools/node:defs.bzl", "node_asset_stage", "node_webapp")

node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": "//projects/libs/demo-wasm:wasm", "dest": "top.wasm"},
    ],
    out = "dist",
)
`,
        );

        await $({
          cwd: appDir,
          stdio: "inherit",
          env: { ...process.env },
        })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
        await $({
          cwd: tmp,
          stdio: "inherit",
        })`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`git add -A projects/apps/demo-web projects/libs/demo-wasm build-tools/tools/nix/node-modules.hashes.json build-tools/tools/nix/langs.nix build-tools/lang/importer_roots.bzl build-tools/tools/buck third_party/providers`;

        const lockfile = path.join("projects", "apps", "demo-web", "pnpm-lock.yaml");
        const envWithPrefetch = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<
          string,
          string
        >;
        await $({
          cwd: tmp,
          stdio: "inherit",
          env: { ...envWithPrefetch },
        })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
        await $({
          cwd: appDir,
          stdio: "inherit",
          env: { ...envWithPrefetch },
        })`zx-wrapper ../../../build-tools/tools/dev/node-modules-build.ts`;

        const build = await $({
          cwd: tmp,
          stdio: "pipe",
          env: { ...process.env, WEB_WASM_BACKEND: "wasi_single" },
        })`buck2 build --target-platforms prelude//platforms:default --show-output //projects/apps/demo-web:webapp`;
        const outText = String(build.stdout || build.stderr || "").trim();
        const outLine = outText.split(/\n+/).pop() || "";
        const outDir = outLine.split(/\s+/).pop() || "";
        if (!outDir) throw new Error("no output dir from buck2 build for staged webapp");
        const outPath = path.isAbsolute(outDir) ? outDir : path.join(tmp, outDir);
        const stagedWasm = path.join(outPath, "top.wasm");
        const stat = await fs.stat(stagedWasm);
        assert.ok(stat.size > 0, "expected staged top.wasm to be non-empty");
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
