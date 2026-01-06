#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr5: tinygo top.wasm builds and loader returns add(2,3)=5", async () => {
  await runInTemp("pr5-tinygo-wasm", async (tmp, $) => {
    // 1) Scaffold minimal C++ wasm static lib (per PR-4)
    const coreDir = path.join(tmp, "libs", "math-core");
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
      `load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/cwrapper/addon.c"],
    headers = ["include/addon.h"],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 2) TinyGo package exporting a wasm function `add`
    const apiDir = path.join(tmp, "libs", "math-api");
    await fs.mkdirp(apiDir);
    await fs.outputFile(
      path.join(apiDir, "go.mod"),
      `module example.com/math/api

go 1.22.0
`,
    );
    await fs.outputFile(
      path.join(apiDir, "main.go"),
      `package main

//export add
func add(a int32, b int32) int32 {
  return a + b
}

func main() {}
`,
    );
    await fs.outputFile(
      path.join(apiDir, "TARGETS"),
      `load("//go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    deps = ["//libs/math-core:core_wasm"],
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 3) Provide C++ defs in the temp repo
    await fs.outputFile(
      path.join(tmp, "cpp", "defs.bzl"),
      await fs.readFile("cpp/defs.bzl", "utf8"),
    );

    // 4) Export graph and build TinyGo wasm via graph-generator-selected-wasm
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const { stdout: outSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/math-api:wasm" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected-wasm`} --accept-flake-config --no-link --print-out-paths`;
    const outPath =
      String(outSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) throw new Error("no out path from graph-generator-selected-wasm");
    const wasmPath = path.join(outPath, "lib", "top.wasm");
    const ok =
      await $`bash --noprofile --norc -c ${`test -f ${wasmPath} && echo ok || true`}`.nothrow();
    if (
      !String(ok.stdout || "")
        .trim()
        .includes("ok")
    ) {
      throw new Error("expected top.wasm under out/lib");
    }

    // 5) A tiny ESM loader that instantiates the provided wasm URL and returns exports
    const tsDir = path.join(tmp, "libs", "math-ts", "src", "browser");
    await fs.mkdirp(tsDir);
    const loaderPath = path.join(tsDir, "index.mjs");
    await fs.writeFile(
      loaderPath,
      `
export async function loadFrom(url) {
  if (url.startsWith("file://")) {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(new URL(url));
    let instance;
    try {
      ({ instance } = await WebAssembly.instantiate(bytes, {}));
    } catch (e) {
      // Fallback: if module expects WASI, provide a minimal WASI import
      const { WASI } = await import('node:wasi');
      const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
      ({ instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport }));
      if (typeof wasi.start === 'function') wasi.start(instance);
    }
    const exp = instance.exports;
    return { add: (a, b) => exp.add(a, b) };
  }
  const res = await fetch(url);
  let inst;
  try {
    ({ instance: inst } = await WebAssembly.instantiateStreaming(res, {}));
  } catch (e) {
    const buf = await (await fetch(url)).arrayBuffer();
    try {
      ({ instance: inst } = await WebAssembly.instantiate(buf, {}));
    } catch {
      const { WASI } = await import('node:wasi');
      const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
      ({ instance: inst } = await WebAssembly.instantiate(buf, { wasi_snapshot_preview1: wasi.wasiImport }));
      if (typeof wasi.start === 'function') wasi.start(inst);
    }
  }
  const exp = inst.exports;
  return { add: (a, b) => exp.add(a, b) };
}
`,
      "utf8",
    );

    // 6) Import the loader and assert add(2,3) === 5 using Node's WebAssembly
    const fileUrl = "file://" + loaderPath;
    const mod = await import(fileUrl);
    const api = await mod.loadFrom("file://" + wasmPath);
    const got = api.add(2, 3);
    if (got !== 5) {
      throw new Error(`expected 5, got ${got}`);
    }
  });
});
