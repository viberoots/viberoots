import * as fs from "node:fs/promises";
import path from "node:path";

export function rustWasmRemoteTargets(): string[] {
  return [
    "REMOTE = {",
    '  "artifact_contract": "remote-evidence/artifact-contract.json",',
    '  "labels": ["remote:ready"],',
    '  "materialization_manifest": "remote-evidence/materialization-manifest.json",',
    '  "remote_builder_smoke": "remote-evidence/remote-builder-smoke.json",',
    '  "source_snapshot_bundle": ":remote-snapshot",',
    '  "tool_closure": "remote-evidence/tool-closure.json",',
    "}",
    'source_snapshot(name = "remote-snapshot", destination_prefix = "projects/apps/rust-wasm", graph = "graph.json", srcs = glob(["remote-src/**"]), strip_prefix = "remote-src")',
    'rust_wasm_static_library(name = "remote_static", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_header = "rust_wasm_fixture.h", **REMOTE)',
    'rust_wasm_static_library(name = "remote_wasi_static", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_abi = "wasi", wasm_header = "rust_wasm_fixture.h", **REMOTE)',
    'rust_wasm_browser_package(name = "remote_browser", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], features = ["browser"], exported_functions = ["answer", "dependency_answer"], **REMOTE)',
    'rust_wasm_component(name = "remote_component", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"], **REMOTE)',
    'rust_wasm_component(name = "remote_wasi_component", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"], wasm_abi = "wasi", component_adapter = "wasi-preview1-reactor", wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add", "dependency-answer"], **REMOTE)',
  ];
}

export async function writeRustWasmRemoteInputs(root: string, sourceRoot: string): Promise<void> {
  for (const relative of [
    "artifact-contract.json",
    "materialization-manifest.json",
    "remote-builder-smoke.json",
  ]) {
    const source = path.join(
      sourceRoot,
      "build-tools/tools/tests/remote-exec/wrapper-fixtures",
      relative,
    );
    const destination = path.join(root, "remote-evidence", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  await fs.writeFile(
    path.join(root, "remote-evidence/tool-closure.json"),
    `${JSON.stringify(
      {
        schemaVersion: "viberoots.rust-wasm-tool-closure.v1",
        manifest: "share/viberoots-rust/wasm-manifest.json",
        tools: [
          {
            key: "rustToolchain",
            name: "Rust toolchain",
            executables: ["bin/cargo", "bin/rustc"],
          },
          { key: "wasmBindgen", name: "wasm-bindgen", executables: ["bin/wasm-bindgen"] },
          { key: "wasmTools", name: "wasm-tools", executables: ["bin/wasm-tools"] },
          { key: "wasmOpt", name: "Binaryen", executables: ["bin/wasm-opt"] },
          { key: "wasmtime", name: "Wasmtime", executables: ["bin/wasmtime"] },
          {
            key: "llvm",
            name: "LLVM",
            executables: ["bin/llvm-ar", "bin/llvm-nm"],
          },
          { key: "jq", name: "jq", executables: ["bin/jq"] },
        ],
      },
      null,
      2,
    )}\n`,
  );
  for (const relative of [
    "Cargo.lock",
    "Cargo.toml",
    "rust_wasm_fixture.h",
    "src/lib.rs",
    "src/main.rs",
    "wit/math.wit",
  ]) {
    const destination = path.join(root, "remote-src", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, relative), destination);
  }
  await fs.writeFile(path.join(root, "graph.json"), "[]\n");
}

export async function finalizeRustWasmRemoteGraph(tmp: string, command: any): Promise<void> {
  await fs.copyFile(
    path.join(tmp, ".viberoots/workspace/buck/graph.json"),
    path.join(tmp, "projects/apps/rust-wasm/graph.json"),
  );
  await command`git add -f projects/apps/rust-wasm/graph.json`;
}
