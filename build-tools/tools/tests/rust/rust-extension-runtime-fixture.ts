import * as fs from "node:fs/promises";
import path from "node:path";
import { nodeSource, pythonSource } from "./rust-extension-runtime-sources";

const buildScript = "fn main() {}\n";

async function writeRustPackage(
  tmp: string,
  name: string,
  source: string,
  target: string,
  crateType = "cdylib",
): Promise<void> {
  const root = path.join(tmp, "projects/libs", name);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\nbuild="build.rs"\n\n[lib]\ncrate-type=["${crateType}"]\n`,
  );
  await fs.writeFile(
    path.join(root, "Cargo.lock"),
    `version = 3\n\n[[package]]\nname = "${name}"\nversion = "0.1.0"\n`,
  );
  await fs.writeFile(path.join(root, "build.rs"), buildScript);
  await fs.writeFile(path.join(root, "src/lib.rs"), source);
  await fs.writeFile(path.join(root, "TARGETS"), target);
}

export async function writeRustExtensionRuntimeFixture(tmp: string): Promise<void> {
  const baseRoot = path.join(tmp, "projects/libs/extension-base");
  await fs.mkdir(path.join(baseRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(baseRoot, "src/base.cpp"),
    'extern "C" int c_base_answer() { return 40; }\n',
  );
  await fs.writeFile(
    path.join(baseRoot, "TARGETS"),
    'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")\nnix_cpp_library(name="base", srcs=["src/base.cpp"], link_mode="shared", visibility=["PUBLIC"])\n',
  );
  const cRoot = path.join(tmp, "projects/libs/extension-c");
  await fs.mkdir(path.join(cRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(cRoot, "src/answer.cpp"),
    'extern "C" int c_base_answer();\nextern "C" int c_answer() { return c_base_answer() + 2; }\n',
  );
  await fs.writeFile(
    path.join(cRoot, "TARGETS"),
    'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")\nnix_cpp_library(name="answer", srcs=["src/answer.cpp"], link_mode="shared", link_deps=["//projects/libs/extension-base:base"], visibility=["PUBLIC"])\n',
  );
  await writeRustPackage(
    tmp,
    "rust_runtime_bundle",
    "pub fn runtime_marker() -> u8 { 1 }\n",
    'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")\nrust_library(name="bundle", crate="rust_runtime_bundle", srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/extension-c:answer"], visibility=["PUBLIC"])\n',
    "rlib",
  );
  await writeRustPackage(
    tmp,
    "rust_pyext",
    pythonSource,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_extension")',
      'rust_python_extension(name="extension", module="demo._native", crate="rust_pyext", srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_python_extension(name="bad_abi", module="demo._native", python_abi="cp00", crate="rust_pyext", srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      "",
    ].join("\n"),
  );
  await writeRustPackage(
    tmp,
    "rust_addon",
    nodeSource,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_node_addon")',
      'rust_node_addon(name="addon", addon_name="rust_native", node_api_version=8, crate="rust_addon", features=["napi8"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_node_addon(name="addon9", addon_name="rust_native9", node_api_version=9, crate="rust_addon", features=["napi9"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      'rust_node_addon(name="addon10", addon_name="rust_native10", node_api_version=10, crate="rust_addon", features=["napi10"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      'rust_node_addon(name="addon_mismatch", addon_name="rust_native_mismatch", node_api_version=8, crate="rust_addon", features=["napi8", "napi_mismatch"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      "",
    ].join("\n"),
  );
  await fs.appendFile(
    path.join(tmp, "projects/libs/rust_addon/Cargo.toml"),
    "\n[features]\nnapi8 = []\nnapi9 = []\nnapi10 = []\nnapi_mismatch = []\n",
  );
}

export async function writeCombinedRustExtensionPackage(tmp: string): Promise<void> {
  await writeRustExtensionRuntimeFixture(tmp);
  const source = `#[cfg(feature = "python")]\nmod python {\n${pythonSource}\n}\n#[cfg(feature = "node")]\nmod node {\n${nodeSource}\n}\n`;
  await writeRustPackage(
    tmp,
    "rust_extensions",
    source,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_node_addon", "rust_python_extension")',
      'rust_python_extension(name="extension", module="demo._native", crate="rust_extensions", features=["python"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_node_addon(name="addon", addon_name="rust_native", node_api_version=8, crate="rust_extensions", features=["node", "napi8"], srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      "",
    ].join("\n"),
  );
  await fs.appendFile(
    path.join(tmp, "projects/libs/rust_extensions/Cargo.toml"),
    "\n[features]\npython = []\nnode = []\nnapi8 = []\n",
  );
}
