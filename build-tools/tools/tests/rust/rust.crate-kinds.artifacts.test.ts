#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInTemp } from "../lib/test-helpers";
import {
  assertNativeConstruction,
  assertPanicAborts,
  buildRustInteropTargets,
  readJson,
} from "./rust.interop-runtime-helpers";

test("Rust native crate kinds expose stable artifacts and staticlib links into C++", async () => {
  await runInTemp("rust-native-crate-kinds", async (tmp, $) => {
    const root = path.join(tmp, "projects", "libs", "rust_abi");
    const runtime = path.join(tmp, "projects", "libs", "rust_runtime");
    const consumer = path.join(tmp, "projects", "apps", "rust_abi_consumer");
    await fsp.mkdir(path.join(root, "src"), { recursive: true });
    await fsp.mkdir(path.join(runtime, "src"), { recursive: true });
    await fsp.mkdir(path.join(consumer, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(runtime, "src", "runtime.c"),
      "int native_c_value(void) { return 40; }\n",
    );
    await fsp.writeFile(
      path.join(runtime, "src", "runtime.cpp"),
      [
        '#include "../include/interop_native.hpp"',
        "#include <stdexcept>",
        "int cpp_native_value() { return 40; }",
        'int cpp_throwing() { throw std::runtime_error("contained"); }',
      ].join("\n"),
    );
    await fsp.mkdir(path.join(runtime, "include"), { recursive: true });
    await fsp.writeFile(
      path.join(runtime, "include", "interop_native.hpp"),
      "int cpp_native_value();\nint cpp_throwing();\n",
    );
    await fsp.writeFile(
      path.join(runtime, "include", "interop_native.h"),
      "int native_c_value(void);\n",
    );
    await fsp.writeFile(
      path.join(runtime, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        'nix_cpp_library(name = "c_runtime", language_standard = "c11", stl = "none", srcs = ["src/runtime.c", "include/interop_native.h"], visibility = ["PUBLIC"])',
        'nix_cpp_library(name = "cpp_runtime", link_mode = "shared", srcs = ["src/runtime.cpp", "include/interop_native.hpp"], visibility = ["PUBLIC"])',
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "Cargo.toml"),
      [
        "[package]",
        'name = "rust_abi"',
        'version = "0.1.0"',
        'edition = "2021"',
        "[lib]",
        'crate-type = ["rlib", "staticlib", "cdylib"]',
        "[features]",
        "c_bridge = []",
        "cxx_bridge = []",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rust_abi"\nversion = "0.1.0"\n',
    );
    await fsp.writeFile(
      path.join(root, "src", "lib.rs"),
      [
        "use std::ffi::{c_char, c_void, CString};",
        "#[no_mangle]",
        '#[cfg(any(feature = "c_bridge", feature = "cxx_bridge"))]',
        'pub extern "C" fn rust_answer() -> i32 { unsafe { __viberoots_abi::vbr_native_value() + 2 } }',
        "#[no_mangle]",
        'pub extern "C" fn rust_error() -> i32 { -5 }',
        "#[no_mangle]",
        'pub extern "C" fn rust_panics() -> i32 { panic!("intentional ABI abort evidence") }',
        "#[no_mangle]",
        'pub extern "C" fn rust_apply(callback: extern "C" fn(i32, *mut c_void) -> i32, context: *mut c_void) -> i32 { callback(40, context) }',
        "#[no_mangle]",
        'pub extern "C" fn rust_make_value() -> *mut c_void { Box::into_raw(Box::new(CString::new("owned").unwrap())).cast() }',
        "#[no_mangle]",
        'pub unsafe extern "C" fn rust_value_text(value: *const c_void) -> *const c_char { (*(value.cast::<CString>())).as_ptr() }',
        "#[no_mangle]",
        'pub unsafe extern "C" fn rust_destroy(value: *mut c_void) { if !value.is_null() { drop(Box::from_raw(value.cast::<CString>())); } }',
        '#[cfg(feature = "cxx_bridge")]',
        "#[no_mangle]",
        'pub extern "C" fn rust_call_cpp_failure() -> i32 { unsafe { __viberoots_abi::vbr_cpp_failure() } }',
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "bindings.json"),
      `${JSON.stringify({
        schema: "viberoots.rust-interop.v1",
        namespace: "rust_abi",
        headers: ["interop_native.hpp"],
        functions: [
          { name: "rust_answer", return: "i32", params: [] },
          { name: "rust_error", return: "i32", params: [] },
          { name: "rust_panics", return: "i32", params: [] },
          {
            name: "rust_apply",
            return: "i32",
            callback_error_value: -66,
            params: [
              { name: "callback", type: "callback_i32" },
              { name: "context", type: "mut_void_ptr" },
            ],
          },
          {
            name: "rust_value_text",
            return: "const_char_ptr",
            params: [{ name: "value", type: "const_void_ptr" }],
          },
          {
            name: "rust_destroy",
            ownership: "destructor",
            return: "void",
            params: [{ name: "value", type: "mut_void_ptr" }],
          },
          {
            name: "rust_make_value",
            return: "mut_void_ptr",
            ownership: "rust",
            params: [],
          },
          { name: "rust_call_cpp_failure", return: "i32", params: [] },
          {
            name: "vbr_cpp_failure",
            cpp_name: "cpp_throwing",
            direction: "import",
            header: "interop_native.hpp",
            return: "i32",
            error_value: -77,
            params: [],
          },
          {
            name: "vbr_native_value",
            cpp_name: "cpp_native_value",
            direction: "import",
            header: "interop_native.hpp",
            return: "i32",
            error_value: -78,
            params: [],
          },
        ],
      })}\n`,
    );
    await fsp.writeFile(
      path.join(root, "bindings-c.json"),
      '{"schema":"viberoots.rust-interop.v1","headers":["interop_native.h"],"functions":[{"name":"rust_answer","return":"i32","params":[]},{"name":"vbr_native_value","native_name":"native_c_value","direction":"import","header":"interop_native.h","return":"i32","params":[]}]}\n',
    );
    await fsp.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_c_ffi_library", "rust_cxx_bridge_library", "rust_library")',
        'rust_library(name = "rlib", crate = "rust_abi", public_crate = "public_abi", srcs = ["src/lib.rs"])',
        'rust_cxx_bridge_library(name = "static", binding_config = "bindings.json", crate = "rust_abi", public_crate = "rust_abi", features = ["cxx_bridge"], exception_policy = "contained", allocator = "rust", srcs = ["src/lib.rs"], link_deps = ["//projects/libs/rust_runtime:cpp_runtime"], header_deps = ["//projects/libs/rust_runtime:cpp_runtime"], visibility = ["PUBLIC"])',
        'rust_c_ffi_library(name = "dynamic", binding_config = "bindings-c.json", artifact = "shared", crate = "rust_abi", public_crate = "rust_abi", features = ["c_bridge"], srcs = ["src/lib.rs"], link_deps = ["//projects/libs/rust_runtime:c_runtime"], header_deps = ["//projects/libs/rust_runtime:c_runtime"], visibility = ["PUBLIC"])',
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(consumer, "src", "main.cpp"),
      [
        "#include <cstdio>",
        "#include <cstring>",
        "#include <stdexcept>",
        "#include <rust_abi.hpp>",
        'extern "C" int add_two(int value, void*) { return value + 2; }',
        'extern "C" int throwing_callback(int, void*) { throw std::runtime_error("callback"); }',
        'int main(int argc, char**) { if (argc > 1) { rust_abi::rust_panics(); std::puts("PANIC_UNWOUND_ACROSS_ABI"); return 99; }',
        "  void* value = rust_abi::rust_make_value();",
        '  if (std::strcmp(rust_abi::rust_value_text(value), "owned") != 0) return 2;',
        "  if (rust_abi::rust_apply(add_two, nullptr) != 42) return 3;",
        "  if (rust_abi::rust_apply(throwing_callback, nullptr) != -66) return 5;",
        "  if (rust_abi::rust_error() != -5) return 4;",
        "  if (rust_abi::rust_call_cpp_failure() != -77) return 6;",
        "  rust_abi::rust_destroy(value);",
        '  std::printf("%d\\n", rust_abi::rust_answer());',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(consumer, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        'nix_cpp_binary(name = "app", srcs = ["src/main.cpp"], link_deps = ["//projects/libs/rust_abi:static"], header_deps = ["//projects/libs/rust_abi:static"], link_closure = "transitive")',
        'nix_cpp_binary(name = "c_app", language_standard = "c11", stl = "none", srcs = ["src/main.c"], link_deps = ["//projects/libs/rust_abi:dynamic"], header_deps = ["//projects/libs/rust_abi:dynamic"])',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(consumer, "src", "main.c"),
      '#include <stdio.h>\n#include <rust_abi.h>\nint main(void) { printf("%d\\n", rust_answer()); return 0; }\n',
    );
    const targets = [
      "//projects/libs/rust_abi:rlib",
      "//projects/libs/rust_abi:static",
      "//projects/libs/rust_abi:dynamic",
      "//projects/apps/rust_abi_consumer:app",
      "//projects/apps/rust_abi_consumer:c_app",
    ];
    const outputs = await buildRustInteropTargets(tmp, $, targets);
    const rlibPath = path.join(outputs[0], "lib/libpublic_abi.rlib");
    const staticPath = path.join(outputs[1], "lib/librust_abi.a");
    const dynamicPath = path.join(outputs[2], "lib/librust_abi.cdylib");
    const appPath = path.join(outputs[3], "bin/projects-apps-rust_abi_consumer-app");
    const cAppPath = path.join(outputs[4], "bin/projects-apps-rust_abi_consumer-c_app");
    assert.equal(path.basename(rlibPath), "libpublic_abi.rlib");
    assert.equal(path.basename(staticPath), "librust_abi.a");
    assert.equal(path.basename(dynamicPath), "librust_abi.cdylib");
    assert.equal((await fsp.readFile(rlibPath)).subarray(0, 8).toString(), "!<arch>\n");
    const archive = await fsp.readFile(staticPath);
    assert.equal(archive.subarray(0, 8).toString(), "!<arch>\n");
    assert.ok((await fsp.stat(dynamicPath)).size > 0);
    await assertNativeConstruction($, outputs, dynamicPath);
    const manifest = await readJson(
      path.join(outputs[1], "share/viberoots-rust/interop-manifest.json"),
    );
    assert.deepEqual(manifest.abiPolicy, {
      exceptionPolicy: "contained",
      panicStrategy: "abort",
      allocator: "rust",
      threadSafety: "send-sync",
      cxxStandard: "c++17",
      cStandard: "",
    });
    const materialization = await readJson(
      path.join(outputs[2], "share/viberoots-rust/materialization-manifest.json"),
    );
    assert.match(JSON.stringify(materialization.storePaths), /rust-interop-rust_abi/);
    const python = ensureNixStoreToolPathSync("python3");
    const hostileEnv = { ...process.env, PATH: "/hostile" };
    const load = await $({ cwd: tmp, env: hostileEnv, stdio: "pipe" })`
      ${python} -c ${`import ctypes; lib=ctypes.CDLL(${JSON.stringify(dynamicPath)}); assert lib.rust_answer() == 42`}
    `;
    assert.equal(load.exitCode, 0);
    const linked = await $({ cwd: tmp, env: hostileEnv, stdio: "pipe" })`${appPath}`;
    assert.equal(String(linked.stdout).trim(), "42");
    await assertPanicAborts($, tmp, appPath);
    const cLinked = await $({ cwd: tmp, env: hostileEnv, stdio: "pipe" })`${cAppPath}`;
    assert.equal(String(cLinked.stdout).trim(), "42");
  });
});
