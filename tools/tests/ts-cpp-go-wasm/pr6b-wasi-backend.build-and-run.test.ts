#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr6b: wasi_single backend builds and runs add(2,3)=5 via node:wasi", async () => {
  await runInTemp("pr6b-wasi-backend", async (tmp, $) => {
    // 1) Scaffold minimal C wrapper and header (pure compute) in a temp repo
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
    # Indicate WASI backend selection via label (planner reads "wasm:wasi")
    labels = ["lang:cpp", "kind:lib", "wasm:wasi"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 2) Provide C++ defs in the temp repo (planner-visible)
    await fs.outputFile(
      path.join(tmp, "cpp", "defs.bzl"),
      await fs.readFile("cpp/defs.bzl", "utf8"),
    );

    // 3) Export graph once
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config .#zx-wrapper -- tools/buck/export-graph.ts --out tools/buck/graph.json`;

    // 4) Build C++ WASI static lib via selected (planner routes flavor:wasm + wasm:wasi)
    const { stdout: outCppSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TARGET: "//libs/math-core:core_wasm",
        PLANNER_ONLY_CPP: "1",
      },
    })`nix run --accept-flake-config .#zx-wrapper -- tools/dev/build-selected.ts`;
    const outCppPath =
      String(outCppSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outCppPath) throw new Error("no out path from build-selected for wasi static lib");
    // Basic artifact presence check
    const libDir = path.join(outCppPath, "lib");
    const files = (await fs.pathExists(libDir)) ? await fs.readdir(libDir) : [];
    if (!files.find((f) => f.endsWith(".a"))) {
      throw new Error(`expected static archive under ${libDir}`);
    }

    // 5) TinyGo package exporting a wasm function `add` (pure Go, no C++ link required for smoke)
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
    # Linking the C++ archive is not required for this WASI smoke test
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 6) Build TinyGo WASI wasm via graph-generator-selected-wasm (WEB_WASM_BACKEND=wasi_single)
    const { stdout: outWasmSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/math-api:wasm", WEB_WASM_BACKEND: "wasi_single" },
    })`nix build --impure -L .#graph-generator-selected-wasm --accept-flake-config --print-out-paths`;
    const outWasmPath =
      String(outWasmSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outWasmPath) throw new Error("no out path from graph-generator-selected-wasm (wasi)");
    const wasiWasm = path.join(outWasmPath, "lib", "top.wasm");
    const ok =
      await $`bash --noprofile --norc -c ${`test -f ${wasiWasm} && echo ok || true`}`.nothrow();
    if (
      !String(ok.stdout || "")
        .trim()
        .includes("ok")
    ) {
      throw new Error("expected lib/top.wasm under selected-wasm out path (wasi)");
    }

    // 7) Minimal Node WASI loader that instantiates the module and returns exports
    const tsDir = path.join(tmp, "libs", "math-ts", "src", "browser");
    await fs.mkdirp(tsDir);
    const loaderPath = path.join(tsDir, "wasi-loader.mjs");
    await fs.writeFile(
      loaderPath,
      `
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

export async function loadWasi(url) {
  const bytes = url.startsWith("file://")
    ? await readFile(new URL(url))
    : await (await fetch(url)).arrayBuffer();
  const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport });
  if (typeof wasi.start === 'function') wasi.start(instance);
  const exp = instance.exports;
  return { add: (a, b) => exp.add(a, b) };
}
`,
      "utf8",
    );

    // 8) Import loader and verify wasm32-wasi backend
    const fileUrl = "file://" + loaderPath;
    const mod = await import(fileUrl);
    const api = await mod.loadWasi("file://" + wasiWasm);
    const got = api.add(2, 3);
    if (got !== 5) throw new Error(`wasi_single expected 5, got ${got}`);
  });
});
