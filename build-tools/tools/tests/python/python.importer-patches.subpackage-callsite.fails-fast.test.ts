#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros fail fast when importer-local patches would cross a Buck package boundary (subpackage call site)", async () => {
  await runInTemp("python-importer-patches-subpackage-callsite-fails-fast", async (tmp, $) => {
    const importerDir = path.join(tmp, "apps", "demo");
    const subpkgDir = path.join(importerDir, "subpkg");
    const patchDir = path.join(importerDir, "patches", "python");

    await fsp.mkdir(path.join(importerDir, "src"), { recursive: true });
    await fsp.mkdir(path.join(subpkgDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });

    await fsp.writeFile(path.join(importerDir, "src", "root.py"), "print('root')\n", "utf8");
    await fsp.writeFile(path.join(subpkgDir, "src", "main.py"), "print('subpkg')\n", "utf8");
    await fsp.writeFile(
      path.join(importerDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fsp.writeFile(path.join(patchDir, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(subpkgDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_library")',
        "",
        "nix_python_library(",
        '  name = "lib",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  srcs = glob(["**/*.py"]),',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/demo/subpkg:lib`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail for subpackage callsite");
    const combined = String(q.stderr || "") + String(q.stdout || "");
    assert.ok(
      combined.includes("Importer-local patches must be wired from the importer package"),
      `expected deterministic package-boundary guidance, got:\n${combined}`,
    );
  });
});
