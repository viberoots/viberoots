#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function instantiateWasmFromFile(filePath: string): Promise<WebAssembly.Instance> {
  const bytes = await fs.readFile(filePath);
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

test("wasm: tinygo transitive closure follows link_deps (build + load)", async () => {
  await runInTemp("wasm-tinygo-transitive-link-closure", async (tmp, $) => {
    const supportDir = path.join(tmp, "libs", "support");
    await fs.outputFile(
      path.join(supportDir, "include", "support.h"),
      `#ifndef SUPPORT_H
#define SUPPORT_H
int inc(int x);
#endif
`,
    );
    await fs.outputFile(
      path.join(supportDir, "src", "support.c"),
      `#include "../include/support.h"
int inc(int x) { return x + 1; }
`,
    );
    await fs.outputFile(
      path.join(supportDir, "TARGETS"),
      `load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "support_wasm",
    srcs = ["src/support.c"],
    headers = ["include/support.h"],
    labels = ["kind:lib"],
    wasm_abi = "wasi",
    visibility = ["PUBLIC"],
)
`,
    );

    const coreDir = path.join(tmp, "libs", "core");
    await fs.outputFile(
      path.join(coreDir, "include", "core.h"),
      `#ifndef CORE_H
#define CORE_H
int add2(int x);
#endif
`,
    );
    await fs.outputFile(
      path.join(coreDir, "src", "core.c"),
      `#include "../include/core.h"
int inc(int x);
int add2(int x) { return inc(x) + 1; }
`,
    );
    await fs.outputFile(
      path.join(coreDir, "TARGETS"),
      `load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/core.c"],
    headers = ["include/core.h"],
    link_deps = ["//libs/support:support_wasm"],
    labels = ["kind:lib"],
    wasm_abi = "wasi",
    visibility = ["PUBLIC"],
)
`,
    );

    const apiDir = path.join(tmp, "libs", "api");
    await fs.outputFile(
      path.join(apiDir, "go.mod"),
      `module example.com/api

go 1.22.0
`,
    );
    await fs.outputFile(
      path.join(apiDir, "main.go"),
      `package main

/*
#include "include/core.h"
*/
import "C"

//export callAdd2
func callAdd2() int32 {
  return int32(C.add2(3))
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
    link_deps = ["//libs/core:core_wasm"],
    link_closure = "transitive",
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
    })`buck2 build --target-platforms prelude//platforms:default //libs/api:wasm`;

    const sel = await $({
      stdio: "pipe",
      env: { ...process.env, BUCK_TARGET: "//libs/api:wasm", WEB_WASM_BACKEND: "wasi_single" },
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
    const got = exp.callAdd2();
    if (got !== 5) throw new Error(`expected 5, got ${got}`);
  });
});
