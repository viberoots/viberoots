#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros default lockfile label fails fast when missing", async () => {
  await runInTemp("python-lockfile-default-missing", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "bar");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "lib.py"), "value = 1\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_library")',
        "",
        "nix_python_library(",
        '  name = "lib",',
        '  srcs = ["lib.py"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/bar:lib`;

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 cquery to fail when the default lockfile is missing",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "nix_python_library: missing lockfile at projects/apps/bar/uv.lock. Provide lockfile_label or create projects/apps/bar/uv.lock.",
      ),
      "expected a targeted missing lockfile error",
    );
  });
});
