#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr7: ts package packaging with conditional exports and artifact staging", async () => {
  await runInTemp("pr7-packaging", async (tmp, $) => {
    const sh = $({ cwd: tmp, stdio: "inherit" });
    const git = $({ cwd: tmp, stdio: "pipe" });

    await git`git init`;
    await git`git config user.email test@example.com`;
    await git`git config user.name test`;

    // Enable C++ in this temp workspace for planner path parity
    await sh`bash --noprofile --norc -c 'mkdir -p build-tools/tools/nix && printf %s \'{"enabled":["cpp"]}\' > build-tools/tools/nix/langs.json'`;

    // 1) Scaffold minimal C wrapper for pure compute: add(a,b)
    const coreDir = path.join(tmp, "projects", "libs", "math-core");
    await fs.outputFile(
      path.join(coreDir, "include", "addon.h"),
      `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
#ifdef __cplusplus
extern "C" {
#endif
int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
`,
    );
    await fs.outputFile(
      path.join(coreDir, "src", "cwrapper", "addon.c"),
      `#include "../../include/addon.h"
int add(int a, int b) { return a + b; }
`,
    );
    await fs.outputFile(
      path.join(coreDir, "TARGETS"),
      `load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/cwrapper/addon.c"],
    headers = ["include/addon.h"],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 2) TinyGo package exporting a wasm function `add` (pure compute)
    const apiDir = path.join(tmp, "projects", "libs", "math-api");
    await fs.mkdirp(apiDir);
    await fs.writeFile(
      path.join(apiDir, "go.mod"),
      `module example.com/math/api

go 1.22.0
`,
      "utf8",
    );
    // Minimal gomod2nix (no deps) so the planner can resolve modulesTomlFor for carchive/wasm targets.
    await fs.writeFile(
      path.join(apiDir, "gomod2nix.toml"),
      [
        "schema = 3",
        "mod = {}",
        "replace = {}",
        "prune = { go-tests = true, unused-packages = true }",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "main.go"),
      `package main

//export add
func add(a int32, b int32) int32 {
  return a + b
}

func main() {}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "TARGETS"),
      `load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib", "nix_go_carchive")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    deps = ["//projects/libs/math-core:core_wasm"],
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)

# Provide a tiny c-archive for the Node addon path (pure add for determinism)
nix_go_carchive(
    name = "carchive",
    srcs = ["main.go"],
    labels = ["lang:go", "kind:carchive"],
    visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    // 3) Node N-API addon binding a trivial add (keeps test self-contained)
    const nativeDir = path.join(tmp, "projects", "libs", "math-native");
    await fs.mkdirp(path.join(nativeDir, "src"));
    await fs.writeFile(
      path.join(nativeDir, "src", "binding.cc"),
      `#include <node_api.h>
#include <assert.h>
#include <stdint.h>

static napi_value AddWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    napi_value zero;
    napi_create_int32(env, 0, &zero);
    return zero;
  }
  int32_t a = 0, b = 0;
  napi_get_value_int32(env, args[0], &a);
  napi_get_value_int32(env, args[1], &b);
  int64_t res = (int64_t)a + (int64_t)b;
  napi_value out;
  napi_create_int32(env, (int32_t)res, &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_status st = napi_create_function(env, "add", NAPI_AUTO_LENGTH, AddWrapped, nullptr, &fn);
  assert(st == napi_ok);
  st = napi_set_named_property(env, exports, "add", fn);
  assert(st == napi_ok);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init);
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(nativeDir, "TARGETS"),
      `load("//build-tools/cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = ["src/binding.cc"],
    deps = [
        "//projects/libs/math-api:carchive",
        "//projects/libs/math-core:core_wasm",  # not strictly required by binding; included for plan parity
    ],
    labels = ["lang:cpp", "kind:addon"],
    visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    // 4) Provide C++ defs in the temp repo (planner-visible)
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "defs.bzl"),
      await fs.readFile("build-tools/cpp/defs.bzl", "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "wasm_defs.bzl"),
      await fs.readFile("build-tools/cpp/wasm_defs.bzl", "utf8"),
    );

    // 5) TS package with dual entries and conditional exports
    const tsPkg = path.join(tmp, "projects", "libs", "math-ts");
    await fs.mkdirp(path.join(tsPkg, "src", "browser"));
    await fs.mkdirp(path.join(tsPkg, "src", "node"));
    await fs.mkdirp(path.join(tsPkg, "src", "types"));
    // Minimal PNPM lockfile so exporter/provider sync sees an importer-scoped lockfile label
    await fs.writeFile(
      path.join(tsPkg, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'\nimporters:\n  .: {}\n`,
      "utf8",
    );
    await fs.writeJson(path.join(tsPkg, "package.json"), {
      name: "@org/math",
      type: "module",
      exports: {
        ".": {
          browser: "./dist/browser/index.js",
          node: "./dist/node/index.cjs",
          default: "./dist/browser/index.js",
        },
      },
      types: "./dist/types/index.d.ts",
    });
    // Browser ESM loader: TLA instantiates top.wasm and re-exports add()
    await fs.writeFile(
      path.join(tsPkg, "src", "browser", "index.js"),
      `
const url = new URL("./top.wasm", import.meta.url);
let inst;
try {
  if (url.protocol === "file:") {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(url);
    try {
      ({ instance: inst } = await WebAssembly.instantiate(bytes, {}));
    } catch {
      const { WASI } = await import('node:wasi');
      const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
      ({ instance: inst } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport }));
      if (typeof wasi.start === 'function') wasi.start(inst);
    }
  } else {
    try {
      const res = await fetch(url);
      ({ instance: inst } = await WebAssembly.instantiateStreaming(res, {}));
    } catch {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      ({ instance: inst } = await WebAssembly.instantiate(buf, {}));
    }
  }
} catch {}
const exp = inst && inst.exports ? inst.exports : {};
export function add(a, b) {
  return exp.add ? exp.add(a, b) : 0;
}
`,
      "utf8",
    );
    // Node CJS shim: require staged .node and re-export add()
    await fs.writeFile(
      path.join(tsPkg, "src", "node", "index.cjs"),
      `
const path = require("node:path");
const addon = require(path.join(__dirname, "../native/math_native.node"));
exports.add = (a, b) => addon.add(a, b);
`,
      "utf8",
    );
    // Shared types
    await fs.writeFile(
      path.join(tsPkg, "src", "types", "index.d.ts"),
      `export declare function add(a: number, b: number): number;
`,
      "utf8",
    );
    // Staging rule: copy entries + artifacts into dist/
    await fs.writeFile(
      path.join(tsPkg, "TARGETS"),
      `load("@prelude//:rules.bzl", "genrule")

genrule(
    name = "dist",
    srcs = [
        "src/browser/index.js",
        "src/node/index.cjs",
        "src/types/index.d.ts",
        "//projects/libs/math-api:wasm",
        "//projects/libs/math-native:napi_addon",
    ],
    out = "dist",
    cmd = "set -euo pipefail; " +
          "mkdir -p \\"$OUT\\"/browser \\"$OUT\\"/node \\"$OUT\\"/native \\"$OUT\\"/types; " +
          "cp src/browser/index.js \\"$OUT\\"/browser/index.js; " +
          "cp src/node/index.cjs \\"$OUT\\"/node/index.cjs; " +
          "cp src/types/index.d.ts \\"$OUT\\"/types/index.d.ts; " +
          "cp $(location //projects/libs/math-api:wasm) \\"$OUT\\"/browser/top.wasm; " +
          "cp $(location //projects/libs/math-native:napi_addon) \\"$OUT\\"/native/math_native.node",
    labels = [
        "lang:node",
        "kind:packaging",
        "lockfile:projects/libs/math-ts/pnpm-lock.yaml#projects/libs/math-ts",
    ],
    visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    // Keep Nix flake source filtering in sync with generated fixture files.
    await git`git add -A`;
    await git`git commit -m scaffold-fixture`;

    // 6) Generate glue (graph + providers + auto_map) for the temp repo to satisfy planner macros
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`${process.execPath} build-tools/tools/dev/install/deps-main.ts --glue-only`;

    // 7) Build artifacts via selected builders and stage to dist/ manually (equivalent to the genrule)
    // Build TinyGo wasm via build-selected (same path used for addon below).
    const { stdout: outWasmSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/libs/math-api:wasm",
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
    const outWasmPath =
      String(outWasmSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outWasmPath) throw new Error("no out path from build-selected for wasm");
    const wasmSrc = path.join(outWasmPath, "lib", "top.wasm");

    // Build Node addon (selected)
    const { stdout: outAddonSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/libs/math-native:napi_addon",
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
    const outAddonPath =
      String(outAddonSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outAddonPath) throw new Error("no out path from build-selected for addon");
    // Probe addon .node path (lib/*.node)
    const addonLibDir = path.join(outAddonPath, "lib");
    const addonFiles = await fs.readdir(addonLibDir);
    const nodeName = addonFiles.find((f) => f.endsWith(".node")) || "";
    if (!nodeName) throw new Error("addon .node artifact not found under nix out/lib");
    const addonSrc = path.join(addonLibDir, nodeName);

    // Stage dist files under projects/libs/math-ts/dist
    const distPath = path.join(tsPkg, "dist");
    await fs.mkdirp(path.join(distPath, "browser"));
    await fs.mkdirp(path.join(distPath, "node"));
    await fs.mkdirp(path.join(distPath, "native"));
    await fs.mkdirp(path.join(distPath, "types"));
    await fs.copyFile(
      path.join(tsPkg, "src", "browser", "index.js"),
      path.join(distPath, "browser", "index.js"),
    );
    await fs.copyFile(
      path.join(tsPkg, "src", "node", "index.cjs"),
      path.join(distPath, "node", "index.cjs"),
    );
    await fs.copyFile(
      path.join(tsPkg, "src", "types", "index.d.ts"),
      path.join(distPath, "types", "index.d.ts"),
    );
    await fs.copyFile(wasmSrc, path.join(distPath, "browser", "top.wasm"));
    await fs.copyFile(addonSrc, path.join(distPath, "native", "math_native.node"));

    // 8) Validate staged artifacts exist
    const expectFiles = [
      path.join(distPath, "browser", "index.js"),
      path.join(distPath, "browser", "top.wasm"),
      path.join(distPath, "node", "index.cjs"),
      path.join(distPath, "native", "math_native.node"),
      path.join(distPath, "types", "index.d.ts"),
    ];
    for (const f of expectFiles) {
      const ok =
        await $`bash --noprofile --norc -c ${`test -f "${f}" && echo ok || true`}`.nothrow();
      if (
        !String(ok.stdout || "")
          .trim()
          .includes("ok")
      ) {
        throw new Error("expected staged file missing: " + f);
      }
    }

    // 9) Simulate `import "@org/math"` via node_modules symlink and verify Node entry
    const nmScope = path.join(tmp, "node_modules", "@org");
    await fs.mkdirp(nmScope);
    const linkTarget = path.relative(
      path.join(nmScope),
      path.join(tmp, "projects", "libs", "math-ts"),
    );
    // Link node_modules/@org/math -> projects/libs/math-ts
    try {
      await fs.symlink(linkTarget, path.join(nmScope, "math"), "dir");
    } catch {
      // best-effort; may already exist
    }
    // Runner for Node path
    await fs.writeFile(
      path.join(tmp, "runner_node.cjs"),
      `
const m = require('@org/math');
const got = m.add(2, 3);
if (got !== 5) {
  console.error('expected 5, got', got);
  process.exit(2);
}
console.log('OK node', got);
`,
      "utf8",
    );
    await $({ cwd: tmp, stdio: "inherit" })`${process.execPath} runner_node.cjs`;

    // 10) Import the browser ESM entry directly and verify
    const browserUrl = "file://" + path.join(distPath, "browser", "index.js");
    const mod = await import(browserUrl);
    const got = typeof mod.add === "function" ? mod.add(2, 3) : 0;
    if (got !== 5) {
      throw new Error(`browser entry expected 5, got ${got}`);
    }
  });
});
