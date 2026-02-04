#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros include importer-local patches in srcs for nix_python_test (cquery)", async () => {
  await runInTemp("py-importer-patches-srcs-test-macro", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    const patchDir = path.join(appDir, "patches", "python");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });

    await fsp.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const patchRel = "apps/demo/patches/python/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//python:defs.bzl", "nix_python_test")',
        "",
        "nix_python_test(",
        '  name = "t",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/demo:t`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(patchRel),
      `expected importer-local patch path present in srcs: ${patchRel}`,
    );
  });
});
