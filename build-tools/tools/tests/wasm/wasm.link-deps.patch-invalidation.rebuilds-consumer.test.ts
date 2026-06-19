#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { buildSelectedOutPath, exportGraphInTemp, runInTemp } from "../lib/test-helpers";

async function instantiateWasmFromFile(filePath: string): Promise<WebAssembly.Instance> {
  const bytes = await fs.readFile(filePath);
  const module = new WebAssembly.Module(bytes);
  const baseImports: Record<string, any> = {};
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

test("wasm: patch change in linked C++ wasm producer rebuilds TinyGo consumer", async () => {
  await runInTemp("wasm-link-deps-patch-invalidation", async (tmp, $) => {
    const coreDir = path.join(tmp, "projects", "libs", "math-core");
    const patchFile = path.join(coreDir, "patches", "cpp", "core_wasm@0.0.0.patch");
    await fs.mkdirp(path.dirname(patchFile));

    await fs.outputFile(
      path.join(coreDir, "include", "addon.h"),
      `#ifndef ADDON_H
#define ADDON_H
int add(int a, int b);
#endif
`,
    );
    await fs.outputFile(
      path.join(coreDir, "src", "addon.c"),
      `#include "../include/addon.h"
int add(int a, int b) { return a + b; }
`,
    );

    const initialPatchText = [
      "diff --git a/src/addon.c b/src/addon.c",
      "--- a/src/addon.c",
      "+++ b/src/addon.c",
      "@@ -1,2 +1,2 @@",
      ' #include "../include/addon.h"',
      "-int add(int a, int b) { return a + b; }",
      "+int add(int a, int b) { return a + b + 1; }",
      "",
    ].join("\n");
    await fs.writeFile(patchFile, initialPatchText, "utf8");

    await fs.outputFile(
      path.join(coreDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/addon.c", "patches/cpp/core_wasm@0.0.0.patch"],
    headers = ["include/addon.h"],
    labels = ["kind:lib"],
    wasm_abi = "wasi",
    visibility = ["PUBLIC"],
)
`,
    );

    const apiDir = path.join(tmp, "projects", "libs", "math-api");
    await fs.outputFile(path.join(apiDir, "go.mod"), `module example.com/math/api\n\ngo 1.22.0\n`);
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
      `load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    link_deps = ["//projects/libs/math-core:core_wasm"],
    visibility = ["PUBLIC"],
)
`,
    );

    await exportGraphInTemp({ tmp, $ });

    const out1 = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/math-api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    const wasm1 = path.join(out1, "lib", "top.wasm");
    await fs.access(wasm1);
    const inst1 = await instantiateWasmFromFile(wasm1);
    const got1 = (inst1.exports as any).add2and3();
    if (got1 !== 6) throw new Error(`expected 6 from the initial patch; got ${got1}`);

    const updatedPatchText = initialPatchText.replace(
      "+int add(int a, int b) { return a + b + 1; }",
      "+int add(int a, int b) { return a + b + 2; }",
    );
    await fs.writeFile(patchFile, updatedPatchText, "utf8");

    const out2 = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/math-api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    if (out2 === out1)
      throw new Error(
        `expected consumer output store path to change after producer patch edit; out=${out1}`,
      );
    const wasm2 = path.join(out2, "lib", "top.wasm");
    await fs.access(wasm2);
    const inst2 = await instantiateWasmFromFile(wasm2);
    const got2 = (inst2.exports as any).add2and3();
    if (got2 !== 7) throw new Error(`expected 7 from patched v2; got ${got2}`);
  });
});
