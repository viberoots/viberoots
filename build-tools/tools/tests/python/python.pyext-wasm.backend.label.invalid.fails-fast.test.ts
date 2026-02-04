#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python pyext_wasm macro rejects unsupported backend labels", async () => {
  await runInTemp("py-pyext-wasm-backend-invalid", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "native"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_wasm_extension_module")',
        "",
        "nix_python_wasm_extension_module(",
        '  name = "ext",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  labels = ["backend:unknown"],',
        '  module = "demo._native",',
        '  srcs = ["native/ext.c"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //apps/demo:ext`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail for invalid backend label");
    const stderr = String(q.stderr || "");
    const expected = "Unsupported backend label for nix_python_wasm_extension_module";
    assert.ok(
      stderr.includes(expected),
      `expected stderr to include '${expected}', got:\n${stderr}`,
    );
    assert.ok(stderr.includes("backend:wasi"), "expected supported backend labels to be listed");
    assert.ok(stderr.includes("backend:pyodide"), "expected supported backend labels to be listed");
  });
});
