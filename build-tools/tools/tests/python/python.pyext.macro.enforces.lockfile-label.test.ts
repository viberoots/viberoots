#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python pyext macro fails with deterministic error text when lockfile label is missing or malformed", async () => {
  await runInTemp("py-pyext-lockfile-label-errors", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "native"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const cases: Array<{ label?: string; expected: string }> = [
      {
        label: "lockfile:projects/apps/demo/uv.lock",
        expected: "missing '#<importer>'",
      },
      {
        label: "lockfile:services/demo/uv.lock#services/demo",
        expected: "Unsupported importer label in lockfile label",
      },
    ];

    for (const c of cases) {
      const lockfileLine = c.label ? `  lockfile_label = "${c.label}",` : "";
      await fsp.writeFile(
        path.join(appDir, "TARGETS"),
        [
          'load("@viberoots//build-tools/python:defs.bzl", "nix_python_extension_module")',
          "",
          "nix_python_extension_module(",
          '  name = "ext",',
          lockfileLine,
          '  module = "demo._native",',
          '  srcs = ["native/ext.c"],',
          ")",
          "",
        ]
          .filter((l) => l !== "")
          .join("\n"),
        "utf8",
      );

      const q = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/demo:ext`;

      assert.notEqual(q.exitCode, 0, "expected cquery to fail for invalid lockfile label");
      const stderr = String(q.stderr || "");
      assert.ok(
        stderr.includes(c.expected),
        `expected stderr to include '${c.expected}', got:\n${stderr}`,
      );
    }
  });
});
