#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros default lockfile label uses package path", async () => {
  await runInTemp("python-lockfile-default-from-package", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "foo");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "uv.lock"), "# uv lock\n", "utf8");
    await fsp.writeFile(path.join(dir, "lib.py"), "value = 1\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_library")',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/foo:lib`;
    if (res.exitCode !== 0) {
      return;
    }
    const out = String(res.stdout || "");
    assert.match(
      out,
      /lockfile:projects\/apps\/foo\/uv\.lock#projects\/apps\/foo/,
      "expected default lockfile label derived from package path",
    );
  });
});
