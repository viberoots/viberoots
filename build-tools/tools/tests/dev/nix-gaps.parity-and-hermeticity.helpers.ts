import fs from "fs-extra";
import path from "node:path";

export async function createHermeticParityFixture(tmp: string): Promise<void> {
  await fs.outputFile(path.join(tmp, ".gitignore"), ".viberoots/\nbuck-out/\n", "utf8");
  const nodeLock = "pnpm-lock.yaml";
  const nodeLabel = `lockfile:${nodeLock}#.`;
  await fs.copy(path.join(tmp, "viberoots", nodeLock), path.join(tmp, nodeLock));
  await fs.copy(path.join(tmp, "viberoots", "package.json"), path.join(tmp, "package.json"));
  for (const rel of [".npmrc", "pnpm-workspace.yaml"]) {
    const source = path.join(tmp, "viberoots", rel);
    if (await fs.pathExists(source)) await fs.copy(source, path.join(tmp, rel));
  }
  await fs.copy(
    path.join(tmp, "viberoots", "build-tools", "tools", "nix", "node-modules.hashes.json"),
    path.join(tmp, "projects", "config", "node-modules.hashes.json"),
  );
  await fs.outputFile(
    path.join(tmp, "hermetic-parity", "src", "input.txt"),
    "node-parity\n",
    "utf8",
  );
  await fs.outputFile(
    path.join(tmp, "hermetic-parity", "src", "ambient.txt"),
    "must-not-enter-the-bundle\n",
    "utf8",
  );
  await fs.appendFile(
    path.join(tmp, "TARGETS"),
    [
      "",
      'load("@viberoots//build-tools/node:defs.bzl", "nix_node_gen")',
      "",
      "nix_node_gen(",
      '    name = "hermetic_parity_gen_bin",',
      '    srcs = ["hermetic-parity/src/input.txt"],',
      '    out = "parity-node.sh",',
      '    cmd = "test ! -e hermetic-parity/src/ambient.txt && cat hermetic-parity/src/input.txt > $OUT",',
      `    labels = ["${nodeLabel}", "kind:bin"],`,
      ")",
      "",
    ].join("\n"),
  );

  const cppDir = path.join(tmp, "projects", "apps", "parity-cpp");
  await fs.outputFile(
    path.join(cppDir, "src", "main.cpp"),
    '#include <iostream>\nint main(){ std::cout<<"cpp-parity\\n"; return 0; }\n',
    "utf8",
  );
  await fs.outputFile(
    path.join(cppDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
      "",
      'nix_cpp_binary(name = "app", srcs = ["src/main.cpp"])',
      "",
    ].join("\n"),
  );

  const rustDir = path.join(tmp, "projects", "apps", "parity-rust");
  await fs.outputFile(path.join(rustDir, "src", "main.rs"), "fn main() {}\n", "utf8");
  await fs.outputFile(
    path.join(rustDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
      "",
      'rust_binary(name = "app", srcs = ["src/main.rs"])',
      "",
    ].join("\n"),
  );

  const goDir = path.join(tmp, "projects", "apps", "parity-go");
  await fs.outputFile(
    path.join(goDir, "cmd", "app", "main.go"),
    'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("go-parity") }\n',
    "utf8",
  );
  await fs.outputFile(path.join(goDir, "go.mod"), "module example.com/parity-go\n\ngo 1.22\n");
  await fs.outputFile(path.join(goDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n");
  await fs.outputFile(
    path.join(goDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/go:defs.bzl", "nix_go_binary")',
      "",
      'nix_go_binary(name = "app", srcs = ["cmd/app/main.go"])',
      "",
    ].join("\n"),
  );

  const pythonDir = path.join(tmp, "projects", "apps", "parity-python");
  await fs.outputFile(path.join(pythonDir, "uv.lock"), "{}\n");
  await fs.outputFile(path.join(pythonDir, "src", "main.py"), 'print("python-parity")\n');
  await fs.outputFile(
    path.join(pythonDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/python:defs.bzl", "nix_python_binary")',
      "",
      'nix_python_binary(name = "app", main = "src/main.py")',
      "",
    ].join("\n"),
  );

  const wasmCppDir = path.join(tmp, "projects", "libs", "parity-wasm-cpp");
  await fs.outputFile(path.join(wasmCppDir, "include", "answer.h"), "int answer(void);\n");
  await fs.outputFile(
    path.join(wasmCppDir, "src", "answer.c"),
    '#include "../include/answer.h"\nint answer(void) { return 42; }\n',
  );
  await fs.outputFile(
    path.join(wasmCppDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
      "",
      "nix_cpp_wasm_static_lib(",
      '    name = "core",',
      '    srcs = ["src/answer.c"],',
      '    headers = ["include/answer.h"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
  const wasmGoDir = path.join(tmp, "projects", "libs", "parity-wasm-go");
  await fs.outputFile(
    path.join(wasmGoDir, "main.go"),
    "package main\n\n//export answer\nfunc answer() int32 { return 42 }\n\nfunc main() {}\n",
  );
  await fs.outputFile(
    path.join(wasmGoDir, "go.mod"),
    "module example.com/parity-wasm-go\n\ngo 1.22\n",
  );
  await fs.outputFile(path.join(wasmGoDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n");
  await fs.outputFile(
    path.join(wasmGoDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
      "",
      "nix_go_tiny_wasm_lib(",
      '    name = "module",',
      '    srcs = ["main.go"],',
      '    link_deps = ["//projects/libs/parity-wasm-cpp:core"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
}
