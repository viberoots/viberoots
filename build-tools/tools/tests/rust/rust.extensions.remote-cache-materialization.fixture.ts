import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";

export const pyodideTarget = `
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app")
load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")
rust_python_wasm_extension(
  name = "rust_ext",
  backend = "pyodide",
  module = "demo._native",
  crate = "rust-pyodide-app",
  srcs = ["src/lib.rs"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
)
nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
  srcs = glob(["**/*.py"]),
  deps = [":rust_ext"],
)
`;

export async function assertPyodideValue(outPath: string, $: any) {
  const run = await $({ stdio: "pipe" })`node ${path.join(outPath, "bin", "run.mjs")}`;
  assert.match(String(run.stdout), /RUST_VALUE=42/);
}

export async function readPyodideAbi(outPath: string) {
  return JSON.parse(
    await fs.readFile(
      path.join(outPath, "share/viberoots-python-wasm/pyemscripten-abi.json"),
      "utf8",
    ),
  );
}
