import * as fs from "node:fs/promises";
import path from "node:path";

export async function writeAdversarialStaticPackage(tmp: string): Promise<void> {
  const packageRoot = path.join(tmp, "projects/apps/rust-wasm-static-profile");
  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, "Cargo.toml"),
    [
      "[package]",
      'name = "rust_wasm_fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[lib]",
      'name = "rust_wasm_fixture"',
      'crate-type = ["staticlib"]',
      "",
      "[profile.release]",
      "opt-level = 3",
      "debug = 2",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(packageRoot, "Cargo.lock"),
    'version = 3\n\n[[package]]\nname = "rust_wasm_fixture"\nversion = "0.1.0"\n',
  );
  await fs.writeFile(
    path.join(packageRoot, "src/lib.rs"),
    [
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { 42 }',
      "#[no_mangle]",
      'pub extern "C" fn dependency_answer() -> i32 { 42 }',
      "#[no_mangle]",
      'pub extern "C" fn add(a: i32, b: i32) -> i32 { a + b }',
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(packageRoot, "rust_wasm_fixture.h"),
    "int answer(void);\nint dependency_answer(void);\nint add(int a, int b);\n",
  );
  await fs.writeFile(
    path.join(packageRoot, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_wasm_static_library")',
      'rust_wasm_static_library(name = "none", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", visibility = ["PUBLIC"])',
      'rust_wasm_static_library(name = "speed_debug", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", wasm_debug = True, wasm_optimize = "speed", visibility = ["PUBLIC"])',
      'rust_wasm_static_library(name = "size", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", wasm_optimize = "size", visibility = ["PUBLIC"])',
      "",
    ].join("\n"),
  );
}

export async function writeCrossLanguageFixtures(tmp: string): Promise<void> {
  const cppRoot = path.join(tmp, "projects/libs/cpp-rust");
  await fs.mkdir(cppRoot, { recursive: true });
  await fs.writeFile(path.join(cppRoot, "answer.c"), "int cpp_answer(void) { return 42; }\n");
  await fs.writeFile(
    path.join(cppRoot, "tinygo_consumer.c"),
    "extern int tiny_answer(void);\nint cpp_tiny_answer(void) { return tiny_answer(); }\n",
  );
  await fs.writeFile(
    path.join(cppRoot, "rust_consumer.c"),
    '#include "rust_wasm_fixture.h"\nint cpp_rust_answer(void) { return add(20, 22); }\n',
  );
  await fs.writeFile(
    path.join(cppRoot, "allocator.c"),
    [
      "#include <stddef.h>",
      "void *malloc(size_t);",
      "int posix_memalign(void **ptr, size_t alignment, size_t size) {",
      "  (void)alignment;",
      "  *ptr = malloc(size);",
      "  return *ptr == 0 ? 12 : 0;",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(cppRoot, "TARGETS"),
    [
      'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
      'nix_cpp_wasm_static_lib(name = "core", srcs = ["answer.c"], wasm_abi = "bare", visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "tinygo_consumer", srcs = ["tinygo_consumer.c"], wasm_abi = "bare", link_deps = ["//projects/libs/tinygo-producer:static"], visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "rust_consumer", srcs = ["rust_consumer.c"], wasm_abi = "bare", link_deps = ["//projects/apps/rust-wasm-static-profile:none"], visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "rust_consumer_debug", srcs = ["rust_consumer.c"], wasm_abi = "bare", link_deps = ["//projects/apps/rust-wasm-static-profile:speed_debug"], visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "rust_consumer_size", srcs = ["rust_consumer.c"], wasm_abi = "bare", link_deps = ["//projects/apps/rust-wasm-static-profile:size"], visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "core_wasi", srcs = ["answer.c"], wasm_abi = "wasi", visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "allocator_wasi", srcs = ["allocator.c"], wasm_abi = "wasi", visibility = ["PUBLIC"])',
      'nix_cpp_wasm_static_lib(name = "rust_consumer_wasi", srcs = ["rust_consumer.c"], wasm_abi = "wasi", link_deps = ["//projects/apps/rust-wasm:wasi_static"], visibility = ["PUBLIC"])',
      "",
    ].join("\n"),
  );
  await writeTinyGoConsumer(tmp);
  await writeTinyGoProducer(tmp);
}

async function writeTinyGoConsumer(tmp: string): Promise<void> {
  const root = path.join(tmp, "projects/libs/tinygo-rust");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "go.mod"), "module example.com/tinygo-rust\n\ngo 1.22.0\n");
  await fs.writeFile(
    path.join(root, "main.go"),
    [
      "package main",
      '/* #include "rust_wasm_fixture.h"',
      "int cpp_answer(void);",
      "*/",
      'import "C"',
      "//export add2and3",
      "func add2and3() int32 { return int32(C.add(2, 3)) }",
      "//export cppAnswer",
      "func cppAnswer() int32 { return int32(C.cpp_answer()) }",
      "//export dependencyAnswer",
      "func dependencyAnswer() int32 { return int32(C.dependency_answer()) }",
      "func main() {}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "TARGETS"),
    [
      'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
      'nix_go_tiny_wasm_lib(name = "wasm", srcs = ["main.go"], link_deps = ["//projects/apps/rust-wasm:static", "//projects/libs/cpp-rust:core"])',
      'nix_go_tiny_wasm_lib(name = "wasm_wasi", srcs = ["main.go"], wasm_abi = "wasi", link_deps = ["//projects/apps/rust-wasm:wasi_static", "//projects/libs/cpp-rust:core_wasi", "//projects/libs/cpp-rust:allocator_wasi"])',
      "",
    ].join("\n"),
  );
}

async function writeTinyGoProducer(tmp: string): Promise<void> {
  const root = path.join(tmp, "projects/libs/tinygo-producer");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "go.mod"),
    "module example.com/tinygo-producer\n\ngo 1.22.0\n",
  );
  await fs.writeFile(
    path.join(root, "main.go"),
    'package main\nimport "C"\n//export tiny_answer\nfunc tiny_answer() int32 { return 42 }\nfunc main() {}\n',
  );
  await fs.writeFile(path.join(root, "tinygo.h"), "int tiny_answer(void);\n");
  await fs.writeFile(
    path.join(root, "TARGETS"),
    [
      'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_static_lib")',
      'nix_go_tiny_wasm_static_lib(name = "static", srcs = ["main.go"], wasm_header = "tinygo.h", visibility = ["PUBLIC"])',
      "",
    ].join("\n"),
  );
}
