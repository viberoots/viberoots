#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("python macros: legacy nix_native_deps fails with an actionable error", async () => {
  await runInTemp("python-nixpkg-alias", async (tmp, $) => {
    const pkg = path.join(tmp, "libs", "demo");
    await fsp.mkdir(path.join(pkg, "src"), { recursive: true });
    await fsp.writeFile(path.join(pkg, "src", "mod.py"), "def x():\n  return 1\n", "utf8");
    // Make python macros available in temp
    await fsp.writeFile(
      path.join(tmp, "python", "defs.bzl"),
      await fsp.readFile("python/defs.bzl", "utf8"),
    );
    // Legacy kwarg should fail deterministically
    const lock = "lockfile:libs/demo/uv.lock#libs/demo";
    await fsp.writeFile(
      path.join(pkg, "TARGETS"),
      [
        'load("//python:defs.bzl", "nix_python_library")',
        "",
        "nix_python_library(",
        '  name = "legacy",',
        '  lockfile_label = "%s",'.replace("%s", lock),
        '  srcs = ["src/mod.py"],',
        '  nix_native_deps = ["pkgs.zlib"],',
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
    })`buck2 cquery --json --output-attribute labels "deps(//libs/demo:legacy,0)"`;
    assert.notEqual(probe.exitCode, 0);
    const out = String(probe.stdout || "") + "\n" + String(probe.stderr || "");
    assert.match(out, /nix_native_deps is no longer supported; use nixpkg_deps instead/);
  });
});
