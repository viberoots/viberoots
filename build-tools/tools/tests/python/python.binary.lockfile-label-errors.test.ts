#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python binary fails with deterministic error text when lockfile label is missing or malformed", async () => {
  await runInTemp("py-binary-lockfile-label-errors", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const cases: Array<{ label?: string; expected: string }> = [
      {
        expected:
          "Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>)",
      },
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
          'load("@prelude//:rules.bzl", "python_library")',
          'load("//build-tools/python:defs.bzl", "nix_python_binary")',
          "",
          "python_library(",
          '  name = "lib",',
          '  srcs = ["src/main.py"],',
          ")",
          "",
          "nix_python_binary(",
          '  name = "bin",',
          lockfileLine,
          '  main = "src/main.py",',
          '  deps = [":lib"],',
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
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/demo:bin`;

      assert.notEqual(q.exitCode, 0, "expected cquery to fail for invalid lockfile label");
      const stderr = String(q.stderr || "");
      assert.ok(
        stderr.includes(c.expected),
        `expected stderr to include '${c.expected}', got:\n${stderr}`,
      );
    }
  });
});
