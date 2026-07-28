#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const load = [
  'load("@viberoots//build-tools/rust:defs.bzl", "rust_wasm_browser_package", "rust_wasm_component", "rust_wasm_library", "rust_wasm_static_library")',
  'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_static_lib")',
].join("\n");

const cases = [
  [
    "source-map-non-browser",
    'rust_wasm_library(name = "app", srcs = ["src/lib.rs"], wasm_source_map = True)',
    /wasm_source_map is supported only by rust_wasm_browser_package/,
  ],
  [
    "static-missing-header",
    'rust_wasm_static_library(name = "app", srcs = ["src/lib.rs"])',
    /WASM static libraries require a package-local wasm_header/,
  ],
  [
    "static-export-allowlist",
    'rust_wasm_static_library(name = "app", srcs = ["src/lib.rs"], wasm_header = "api.h", exported_functions = ["answer"])',
    /exported_functions is unsupported because the final linked module owns its exports/,
  ],
  [
    "source-map-without-debug",
    'rust_wasm_browser_package(name = "app", srcs = ["src/lib.rs"], wasm_source_map = True)',
    /wasm_source_map requires wasm_debug = True/,
  ],
  [
    "component-missing-world",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "math.wit")',
    /requires package-local wit and non-empty wit_world/,
  ],
  [
    "bare-component-adapter",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "math.wit", wit_world = "demo", component_adapter = "wasi-preview1-reactor")',
    /bare ABI requires component_adapter = "none"/,
  ],
  [
    "wasi-component-missing-adapter",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "math.wit", wit_world = "demo", wasm_abi = "wasi")',
    /WASI ABI requires an explicit preview1 adapter/,
  ],
  [
    "invalid-optimization",
    'rust_wasm_browser_package(name = "app", srcs = ["src/lib.rs"], wasm_optimize = "fastest")',
    /wasm_optimize must be one of/,
  ],
  [
    "regex-export-identifier",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "math.wit", wit_world = "demo", exported_functions = [".*"])',
    /exported_functions entries must match/,
  ],
  [
    "header-traversal",
    'rust_wasm_static_library(name = "app", srcs = ["src/lib.rs"], wasm_header = "../shared.h")',
    /wasm_header must remain within the package/,
  ],
  [
    "header-external-repository",
    'rust_wasm_static_library(name = "app", srcs = ["src/lib.rs"], wasm_header = "@external//shared:api.h")',
    /wasm_header must remain within the package/,
  ],
  [
    "tinygo-header-external-repository",
    'nix_go_tiny_wasm_static_lib(name = "app", srcs = ["main.go"], wasm_header = "@external//shared:api.h")',
    /requires a package-local wasm_header/,
  ],
  [
    "tinygo-wasi-static-allocator",
    'nix_go_tiny_wasm_static_lib(name = "app", srcs = ["main.go"], wasm_header = "tinygo.h", wasm_abi = "wasi")',
    /WASI static archives are unsupported.*allocator symbols/,
  ],
  [
    "wit-cross-package",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "//projects/libs/shared:math.wit", wit_world = "demo")',
    /wit must remain within the package/,
  ],
  [
    "wit-external-repository",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "@external//shared:math.wit", wit_world = "demo")',
    /wit must remain within the package/,
  ],
  [
    "unsupported-command-adapter",
    'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], wit = "math.wit", wit_world = "demo", wasm_abi = "wasi", component_adapter = "wasi-preview1-command")',
    /component_adapter must be one of/,
  ],
] as const;

const selectedCase = process.env.VIBEROOTS_WASM_CONTRACT_CASE;
for (const [name, declaration, expected] of cases.filter(
  ([name]) => !selectedCase || name === selectedCase,
)) {
  test(`Rust WASM contract rejects ${name}`, async () => {
    await runInTemp(`rust-wasm-contract-${name}`, async (tmp, $) => {
      const root = path.join(tmp, "projects/apps/rust-wasm-contract");
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(
        path.join(root, "Cargo.toml"),
        '[package]\nname="contract"\nversion="0.1.0"\n',
      );
      await fs.writeFile(path.join(root, "Cargo.lock"), "version = 3\n");
      await fs.writeFile(path.join(root, "src/lib.rs"), "#![no_std]\n");
      await fs.writeFile(path.join(root, "math.wit"), "package test:math;\nworld demo {}\n");
      await fs.writeFile(path.join(root, "TARGETS"), `${load}\n${declaration}\n`);
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rust-wasm-contract:app`;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), expected);
    });
  });
}
