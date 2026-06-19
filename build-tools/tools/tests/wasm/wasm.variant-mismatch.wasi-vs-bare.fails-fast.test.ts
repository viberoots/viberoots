#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { exportGraphInTemp, runBuildSelected, runInTemp } from "../lib/test-helpers";

test("wasm: variant mismatch (TinyGo WASI vs bare lib) fails fast with targeted error", async () => {
  await runInTemp("wasm-variant-mismatch-wasi-vs-bare", async (tmp, $) => {
    const coreDir = path.join(tmp, "projects", "libs", "math-core");
    await fs.outputFile(
      path.join(coreDir, "include", "addon.h"),
      `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
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
    await fs.outputFile(
      path.join(coreDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/addon.c"],
    headers = ["include/addon.h"],
    labels = ["kind:lib"],
    visibility = ["PUBLIC"],
)
`,
    );

    const apiDir = path.join(tmp, "projects", "libs", "math-api");
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

    const res = await runBuildSelected({
      tmp,
      $,
      target: "//projects/libs/math-api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });

    if (res.exitCode === 0) {
      throw new Error("expected build-selected to fail on wasm variant mismatch, but it succeeded");
    }
    const combined = `${String(res.stdout || "")}\n${String(res.stderr || "")}`;
    if (!combined.includes("target=wasi") || !combined.includes("wasm:wasi")) {
      throw new Error(
        `expected targeted variant-mismatch error mentioning target=wasi and wasm:wasi; got:\n${combined}`,
      );
    }
  });
});
