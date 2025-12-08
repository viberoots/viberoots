#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("python macros: nixpkg_deps alias parity with nix_native_deps (labels)", async () => {
  await runInTemp("python-nixpkg-alias", async (tmp, $) => {
    const pkg = path.join(tmp, "libs", "demo");
    await fsp.mkdir(path.join(pkg, "src"), { recursive: true });
    await fsp.writeFile(path.join(pkg, "src", "mod.py"), "def x():\n  return 1\n", "utf8");
    // Make python macros available in temp
    await fsp.writeFile(
      path.join(tmp, "python", "defs.bzl"),
      await fsp.readFile("python/defs.bzl", "utf8"),
    );
    // Two targets: one legacy kwarg, one alias
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
        "nix_python_library(",
        '  name = "alias",',
        '  lockfile_label = "%s",'.replace("%s", lock),
        '  srcs = ["src/mod.py"],',
        '  nixpkg_deps = ["pkgs.zlib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = async (name: string) => {
      const probe = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --json --output-attributes labels "deps(//libs/demo:${name}, 0)"`;
      if (probe.exitCode !== 0) return null;
      const json = JSON.parse(String(probe.stdout || "[]")) as Array<{ labels?: string[] }>;
      const labs = (json[0]?.labels || []).slice().sort();
      return labs;
    };
    const legacy = await q("legacy");
    const alias = await q("alias");
    if (!legacy || !alias) return;
    assert.deepEqual(
      alias,
      legacy,
      "labels should be identical for nixpkg_deps vs nix_native_deps",
    );
  });
});
