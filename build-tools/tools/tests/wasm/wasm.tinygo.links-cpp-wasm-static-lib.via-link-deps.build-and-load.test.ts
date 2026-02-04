#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function instantiateWasmFromFile(filePath: string): Promise<WebAssembly.Instance> {
  const bytes = await fs.readFile(filePath);
  const module = new WebAssembly.Module(bytes);
  const baseImports: Record<string, any> = {};
  const env: Record<string, any> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    // TinyGo-produced modules often import `env.*` even for WASI targets.
    // Provide deterministic stubs for any required symbols.
    if (imp.kind === "function") env[imp.name] = () => 0;
    else if (imp.kind === "global")
      env[imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    else if (imp.kind === "memory") env[imp.name] = new WebAssembly.Memory({ initial: 256 });
    else if (imp.kind === "table")
      env[imp.name] = new WebAssembly.Table({ initial: 0, element: "funcref" });
  }
  if (Object.keys(env).length) baseImports.env = env;

  try {
    const instance = await WebAssembly.instantiate(module, baseImports);
    return instance;
  } catch {
    const { WASI } = await import("node:wasi");
    const wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {} });
    const instance = await WebAssembly.instantiate(module, {
      ...baseImports,
      wasi_snapshot_preview1: wasi.wasiImport,
    } as any);
    if (typeof wasi.start === "function") wasi.start(instance);
    return instance;
  }
}

test("wasm: tinygo links a cpp wasm static lib via link_deps (build + load)", async () => {
  await runInTemp("wasm-tinygo-links-cpp-via-link-deps", async (tmp, $) => {
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
      path.join(coreDir, "src", "addon.c"),
      `#include "../include/addon.h"
int add(int a, int b) { return a + b; }
`,
    );
    await fs.outputFile(
      path.join(coreDir, "TARGETS"),
      `load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/addon.c"],
    headers = ["include/addon.h"],
    labels = ["kind:lib"],
    wasm_abi = "wasi",
    visibility = ["PUBLIC"],
)
`,
    );

    const apiDir = path.join(tmp, "libs", "math-api");
    await fs.outputFile(
      path.join(apiDir, "go.mod"),
      `module example.com/math/api

go 1.22.0
`,
    );
    await fs.outputFile(
      path.join(apiDir, "main.go"),
      `package main

/*
#include "include/addon.h"
*/
import "C"

//export add2and3
func add2and3() int32 {
  return int32(C.add(2, 3))
}

func main() {}
`,
    );
    await fs.outputFile(
      path.join(apiDir, "TARGETS"),
      `load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    link_deps = ["//libs/math-core:core_wasm"],
    visibility = ["PUBLIC"],
)
`,
    );

    await $({
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    await $({
      stdio: "inherit",
      env: { ...process.env, WEB_WASM_BACKEND: "wasi_single" },
    })`buck2 build --target-platforms prelude//platforms:default //libs/math-api:wasm`;

    const sel = await $({
      stdio: "pipe",
      env: { ...process.env, BUCK_TARGET: "//libs/math-api:wasm", WEB_WASM_BACKEND: "wasi_single" },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
    const outPath =
      String(sel.stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) throw new Error("no out path emitted by build-selected.ts");

    const wasmPath = path.join(outPath, "lib", "top.wasm");
    await fs.access(wasmPath);
    const inst = await instantiateWasmFromFile(wasmPath);
    const exp = inst.exports as any;
    const got = exp.add2and3();
    if (got !== 5) throw new Error(`expected 5, got ${got}`);
  });
});
