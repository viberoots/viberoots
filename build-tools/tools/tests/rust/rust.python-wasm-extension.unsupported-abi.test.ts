#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Rust Python WASM extensions reject unavailable import ABIs", async () => {
  await runInTemp("rust-python-wasm-unavailable", async (tmp, $) => {
    const root = path.join(tmp, "projects/libs/rust_python_wasm");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")',
        'rust_python_wasm_extension(name="extension", backend="pyodide")',
        "",
      ].join("\n"),
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery //projects/libs/rust_python_wasm:extension`;
    assert.notEqual(result.exitCode, 0);
    assert.match(
      `${String(result.stdout || "")}\n${String(result.stderr || "")}`,
      /backend pyodide is unavailable.*do not provide an importable dynamic-extension ABI/s,
    );
  });
});
