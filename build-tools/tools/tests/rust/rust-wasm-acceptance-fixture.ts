import * as fs from "node:fs/promises";
import path from "node:path";
import { rustWasmRemoteTargets, writeRustWasmRemoteInputs } from "./rust-wasm-remote-fixture";
import {
  writeAdversarialStaticPackage,
  writeCrossLanguageFixtures,
} from "./rust-wasm-acceptance-support-fixture";

export const itoaSource = "registry+https://github.com/rust-lang/crates.io-index";
export const itoaVersion = "1.0.15";
export const itoaChecksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";

export async function writeRustWasmFixture(
  tmp: string,
  sourceRoot: string,
  command: any,
): Promise<string> {
  const root = path.join(tmp, "projects/apps/rust-wasm");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    [
      "[package]",
      'name = "rust_wasm_fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[lib]",
      'crate-type = ["cdylib", "staticlib"]',
      "",
      "[features]",
      'browser = ["dep:wasm-bindgen"]',
      "cpp = []",
      "tinygo = []",
      "cpp_tinygo = []",
      "cpp_rust = []",
      "",
      "[dependencies]",
      `itoa = "=${itoaVersion}"`,
      'wasm-bindgen = { version = "=0.2.100", optional = true }',
      "",
      "[[bin]]",
      'name = "wasi_demo"',
      'path = "src/main.rs"',
      "",
    ].join("\n"),
  );
  await fs.copyFile(
    path.join(sourceRoot, "build-tools/tools/tests/rust/fixtures/wasm-bindgen-0.2.100.Cargo.lock"),
    path.join(root, "Cargo.lock"),
  );
  const lock = await fs.readFile(path.join(root, "Cargo.lock"), "utf8");
  await fs.writeFile(
    path.join(root, "Cargo.lock"),
    lock
      .replace('dependencies = [\n "wasm-bindgen",', 'dependencies = [\n "itoa",\n "wasm-bindgen",')
      .replace(
        '[[package]]\nname = "log"',
        `[[package]]\nname = "itoa"\nversion = "${itoaVersion}"\nsource = "${itoaSource}"\nchecksum = "${itoaChecksum}"\n\n[[package]]\nname = "log"`,
      ),
  );
  await fs.writeFile(
    path.join(root, "src/lib.rs"),
    [
      '#[cfg(feature = "browser")]',
      "use wasm_bindgen::prelude::*;",
      '#[cfg(not(any(feature = "browser", feature = "cpp", feature = "tinygo", feature = "cpp_tinygo", feature = "cpp_rust")))]',
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { 42 }',
      '#[cfg(feature = "cpp")]',
      'extern "C" { fn cpp_answer() -> i32; }',
      '#[cfg(feature = "cpp")]',
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { unsafe { cpp_answer() } }',
      '#[cfg(feature = "tinygo")]',
      'extern "C" { fn tiny_answer() -> i32; }',
      '#[cfg(feature = "tinygo")]',
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { unsafe { tiny_answer() } }',
      '#[cfg(feature = "cpp_tinygo")]',
      'extern "C" { fn cpp_tiny_answer() -> i32; }',
      '#[cfg(feature = "cpp_tinygo")]',
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { unsafe { cpp_tiny_answer() } }',
      '#[cfg(feature = "cpp_rust")]',
      'extern "C" { fn cpp_rust_answer() -> i32; }',
      '#[cfg(feature = "cpp_rust")]',
      "#[no_mangle]",
      'pub extern "C" fn answer() -> i32 { unsafe { cpp_rust_answer() } }',
      '#[cfg(feature = "browser")]',
      "#[wasm_bindgen]",
      "pub fn answer() -> i32 { 42 }",
      "fn dependency_value() -> i32 {",
      "  let mut buffer = itoa::Buffer::new();",
      '  buffer.format(42).parse::<i32>().expect("itoa must format an integer")',
      "}",
      '#[cfg(not(feature = "browser"))]',
      "#[no_mangle]",
      'pub extern "C" fn dependency_answer() -> i32 { dependency_value() }',
      '#[cfg(feature = "browser")]',
      "#[wasm_bindgen]",
      "pub fn dependency_answer() -> i32 { dependency_value() }",
      '#[export_name = "dependency-answer"]',
      'pub extern "C" fn component_dependency_answer() -> i32 { dependency_value() }',
      "#[no_mangle]",
      'pub extern "C" fn add(a: i32, b: i32) -> i32 { a + b }',
      "#[no_mangle]",
      'pub extern "C" fn ping() -> i32 { 42 }',
      '#[export_name = "viberoots:multi/api#ping"]',
      'pub extern "C" fn interface_ping() -> i32 { 42 }',
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "rust_wasm_fixture.h"),
    "int answer(void);\nint dependency_answer(void);\nint add(int a, int b);\n",
  );
  await fs.mkdir(path.join(root, "wit"), { recursive: true });
  await fs.writeFile(
    path.join(root, "wit/math.wit"),
    [
      "package viberoots:math;",
      "world calculator {",
      "  export add: func(a: s32, b: s32) -> s32;",
      "  export dependency-answer: func() -> s32;",
      "}",
      "world unrelated {",
      "  export ignored: func() -> s32;",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "wit/multi.wit"),
    [
      "package viberoots:multi;",
      "interface api { ping: func() -> s32; }",
      "world calculator-with-api {",
      "  export add: func(a: s32, b: s32) -> s32;",
      "  export api;",
      "}",
      "world other { export ignored: func(); }",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "wit/ambiguous.wit"),
    [
      "package viberoots:ambiguous;",
      "interface api { ping: func() -> s32; }",
      "world duplicate-functions {",
      "  export ping: func() -> s32;",
      "  export api;",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src/main.rs"),
    [
      "fn main() {",
      "  let mut buffer = itoa::Buffer::new();",
      '  println!("wasi-rust-{}", buffer.format(42));',
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_wasi_binary", "rust_wasm_browser_package", "rust_wasm_component", "rust_wasm_library", "rust_wasm_static_library")',
      'load("@viberoots//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
      'rust_wasm_library(name = "raw", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp"], link_deps = ["//projects/libs/cpp-rust:core"], visibility = ["PUBLIC"])',
      'rust_wasm_library(name = "raw_allowlist", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], exported_functions = ["answer"], wasm_optimize = "size")',
      'rust_wasm_library(name = "raw_tinygo", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["tinygo"], link_deps = ["//projects/libs/tinygo-producer:static"])',
      'rust_wasm_library(name = "raw_cpp_tinygo", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp_tinygo"], link_deps = ["//projects/libs/cpp-rust:tinygo_consumer"], link_closure = "transitive")',
      'rust_wasm_library(name = "raw_cpp_rust", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp_rust"], link_deps = ["//projects/libs/cpp-rust:rust_consumer"], link_closure = "transitive")',
      'rust_wasm_library(name = "raw_cpp_rust_debug", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp_rust"], link_deps = ["//projects/libs/cpp-rust:rust_consumer_debug"], link_closure = "transitive")',
      'rust_wasm_library(name = "raw_cpp_rust_size", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp_rust"], link_deps = ["//projects/libs/cpp-rust:rust_consumer_size"], link_closure = "transitive")',
      'rust_wasm_library(name = "raw_wasi_cpp", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp"], wasm_abi = "wasi", link_deps = ["//projects/libs/cpp-rust:core_wasi"])',
      'rust_wasm_library(name = "raw_wasi_cpp_rust", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["cpp_rust"], wasm_abi = "wasi", link_deps = ["//projects/libs/cpp-rust:rust_consumer_wasi"], link_closure = "transitive")',
      'rust_wasi_binary(name = "wasi_demo", crate = "rust_wasm_fixture", srcs = ["src/main.rs"])',
      'rust_wasm_static_library(name = "static", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", visibility = ["PUBLIC"])',
      'rust_wasm_static_library(name = "static_debug", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", wasm_debug = True, wasm_optimize = "speed", visibility = ["PUBLIC"])',
      'rust_wasm_static_library(name = "static_size", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", wasm_optimize = "size", visibility = ["PUBLIC"])',
      'rust_wasm_static_library(name = "wasi_static", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_abi = "wasi", wasm_header = "rust_wasm_fixture.h", visibility = ["PUBLIC"])',
      'rust_wasm_browser_package(name = "browser", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["browser"], exported_functions = ["answer", "dependency_answer"], wasm_optimize = "size", visibility = ["PUBLIC"])',
      'rust_wasm_browser_package(name = "browser_debug", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["browser"], exported_functions = ["answer", "dependency_answer"], wasm_optimize = "speed", wasm_debug = True, wasm_source_map = True)',
      'rust_wasm_browser_package(name = "bad_export", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["browser"], exported_functions = ["missing_export"])',
      'rust_wasm_component(name = "component", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"], wasm_optimize = "size", visibility = ["PUBLIC"])',
      'rust_wasm_component(name = "component_debug", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"], wasm_optimize = "speed", wasm_debug = True)',
      'rust_wasm_component(name = "component_rebuilt", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"], wasm_optimize = "size")',
      'rust_wasm_component(name = "component_interface", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/multi.wit", wit_world = "calculator-with-api", exported_functions = ["add", "ping"])',
      'rust_wasm_component(name = "wasi_component", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_abi = "wasi", component_adapter = "wasi-preview1-reactor", wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"])',
      'rust_wasm_component(name = "bad_component_export", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["dependency_answer"])',
      'rust_wasm_component(name = "bad_component_interface_allowlist", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/multi.wit", wit_world = "calculator-with-api", exported_functions = ["add"])',
      'rust_wasm_component(name = "bad_component_ambiguous_functions", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/ambiguous.wit", wit_world = "duplicate-functions", exported_functions = ["ping"])',
      'rust_wasm_component(name = "bad_world", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "absent")',
      ...rustWasmRemoteTargets(),
      "",
    ].join("\n"),
  );
  await writeRustWasmRemoteInputs(root, sourceRoot);
  await writeAdversarialStaticPackage(tmp);
  await writeCrossLanguageFixtures(tmp);
  await command`git add -A projects/apps/rust-wasm projects/apps/rust-wasm-static-profile projects/libs/cpp-rust projects/libs/tinygo-rust projects/libs/tinygo-producer`;
  return root;
}
