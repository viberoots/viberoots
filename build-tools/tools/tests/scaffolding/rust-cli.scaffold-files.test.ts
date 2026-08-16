#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Rust CLI scaffold renders locked Cargo, build, test, and runnable inputs", async () => {
  await runInTemp("rust-cli-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    await $`scaf new rust cli rust_demo --yes`;
    const root = path.join(tmp, "projects/apps/rust_demo");
    const read = (relative: string) => fs.readFile(path.join(root, relative), "utf8");
    const [manifest, lock, targets, source, wasmSource] = await Promise.all([
      read("Cargo.toml"),
      read("Cargo.lock"),
      read("TARGETS"),
      read("src/main.rs"),
      read("src/lib.rs"),
    ]);
    assert.match(manifest, /name = "rust_demo"/);
    assert.match(lock, /name = "rust_demo"/);
    assert.match(targets, /rust_binary\(/);
    assert.match(targets, /rust_test\(/);
    assert.match(targets, /rust_wasm_library\(/);
    assert.match(targets, /rust_wasi_binary\(/);
    assert.match(manifest, /name = "rust_demo-wasi"/);
    assert.match(manifest, /crate-type = \["cdylib", "rlib"\]/);
    assert.match(source, /hello from rust_demo/);
    assert.match(wasmSource, /scaffold_answer/);
    await fs.access(path.join(root, "README.md"));
    await fs.access(path.join(root, "patches/rust/.gitkeep"));
    assert.match(await read("README.md"), /use `i`, `b`, `v`, and `p`/);
  });
});

test("Rust Pyodide scaffold renders locked extension and consumer inputs", async () => {
  await runInTemp("rust-pyodide-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    await $`scaf new rust pyodide-extension rust_pyodide_demo --yes`;
    const root = path.join(tmp, "projects/apps/rust_pyodide_demo");
    const read = (relative: string) => fs.readFile(path.join(root, relative), "utf8");
    const [manifest, lock, targets, source, main, init, readme, uvLock] = await Promise.all([
      read("Cargo.toml"),
      read("Cargo.lock"),
      read("TARGETS"),
      read("src/lib.rs"),
      read("bin/__main__.py"),
      read("src/rust_pyodide_demo/__init__.py"),
      read("README.md"),
      read("uv.lock"),
    ]);
    assert.match(manifest, /pyo3 = \{ version = "0\.22\.6", features = \["extension-module"\] \}/);
    assert.match(lock, /name = "pyo3"/);
    assert.match(targets, /rust_python_wasm_extension\(/);
    assert.match(targets, /nix_python_wasm_app\(/);
    assert.match(targets, /backend = "pyodide"/);
    assert.match(targets, /module = "rust_pyodide_demo\._native"/);
    assert.match(
      targets,
      /lockfile:projects\/apps\/rust_pyodide_demo\/uv\.lock#projects\/apps\/rust_pyodide_demo/,
    );
    assert.match(source, /#\[pymodule\]/);
    assert.match(main, /RUST_PYODIDE_VALUE=/);
    assert.match(init, /_native\.answer\(\)/);
    assert.match(uvLock, /version = 1/);
    assert.match(uvLock, /requires-python = ">=3\.13"/);
    assert.match(readme, /patch-pkg start\/apply\/remove rust/);
    await fs.access(path.join(root, "pyproject.toml"));
    await fs.access(path.join(root, "patches/rust/.gitkeep"));
  });
});
