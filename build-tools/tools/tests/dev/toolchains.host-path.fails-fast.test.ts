#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("buck fails fast when toolchain paths are not in /nix/store", async () => {
  const prev = process.env.TEST_NEED_DEV_ENV;
  try {
    process.env.TEST_NEED_DEV_ENV = "1";
    await runInTemp("toolchains-host-path", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const bzl = path.join(tmp, ".viberoots", "workspace", "toolchains", "toolchain_paths.bzl");
      await fsp.writeFile(
        bzl,
        [
          "# GENERATED FILE — DO NOT EDIT.",
          'NIX_GO_BIN = "/usr/bin/go"',
          'NIX_GO_ROOT = "/usr/local/go"',
          'NIX_PYTHON_BIN = "/usr/bin/python3"',
          "",
        ].join("\n"),
        "utf8",
      );
      const pkg = path.join(tmp, "projects", "apps", "toolchain-demo");
      await fsp.mkdir(pkg, { recursive: true });
      await fsp.writeFile(path.join(pkg, "main.go"), `package main\n\nfunc main() {}\n`, "utf8");
      const targets = [
        'load("@prelude//:rules.bzl", "go_binary")',
        "",
        "go_binary(",
        '    name = "go_bin",',
        '    srcs = ["main.go"],',
        ")",
        "",
      ].join("\n");
      await fsp.writeFile(path.join(pkg, "TARGETS"), targets, "utf8");

      const res =
        await $`buck2 build --target-platforms //:no_cgo //projects/apps/toolchain-demo:go_bin`.nothrow();
      assert.notEqual(res.exitCode, 0, "expected build to fail");
      const stderr = String(res.stderr || "");
      assert.match(stderr, /NIX_(GO|PYTHON)_BIN must be a \/nix\/store path/);
    });
  } finally {
    if (prev === undefined) delete process.env.TEST_NEED_DEV_ENV;
    else process.env.TEST_NEED_DEV_ENV = prev;
  }
});
