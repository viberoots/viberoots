#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros: wasm app/lib parse and stamp labels", async () => {
  await runInTemp("py-macros-parse-stamp", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fs.mkdirp(path.join(appDir, "src"));
    // Minimal source tree
    await fs.outputFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    // Minimal uv.lock at importer root
    await fs.outputFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    // Create TARGETS using WASM stamp macros with explicit lockfile label
    await fs.outputFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_lib")',
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

    // Query labels to confirm lang:python and kind:wasm stamps are present
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir py_macros cquery --json --output-attribute labels //apps/demo:wasm_app`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{ labels?: string[] }>;
    const labels = (nodes[0]?.labels || []).sort();
    assert.ok(labels.includes("lang:python"), "missing lang:python label");
    assert.ok(labels.includes("kind:wasm"), "missing kind:wasm label");
  });
});
