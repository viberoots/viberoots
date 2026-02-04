#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros: nix_python_wasm_* stamp wasm:wasi variant", async () => {
  await runInTemp("py-wasm-variant", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_lib")',
        "",
        "nix_python_wasm_app(",
        '  name = "wasm_app",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  srcs = glob(["**/*.py"]),',
        ")",
        "",
        "nix_python_wasm_lib(",
        '  name = "wasm_lib",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  srcs = glob(["**/*.py"]),',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir py_wasm_variant cquery --json --output-attribute labels //apps/demo:wasm_lib`;
    if (probe.exitCode !== 0) return;
    const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
    const values = Array.isArray(parsed)
      ? (parsed as Array<{ labels?: string[] }>)
      : (Object.values(parsed as Record<string, { labels?: string[] }>) as Array<{
          labels?: string[];
        }>);
    const labels = (values[0]?.labels || []).sort();
    assert.ok(labels.includes("lang:python"), "missing lang:python label");
    assert.ok(labels.includes("kind:wasm"), "missing kind:wasm label");
    assert.ok(labels.includes("wasm:wasi"), "missing wasm:wasi variant label");
  });
});
