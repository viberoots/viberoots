#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python binary carries importer-local patches via synthetic dep (cquery)", async () => {
  await runInTemp("py-binary-importer-patches-helper-lib", async (tmp, $) => {
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
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  main = "src/main.py",',
        '  deps = [":lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const depsQ = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //apps/demo:bin`;
    if (depsQ.exitCode !== 0) {
      return;
    }
    const depsOut = String(depsQ.stdout || "");
    assert.ok(
      depsOut.includes("bin__patch_inputs"),
      "expected internal helper lib to appear in deps",
    );

    const labelsQ = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:bin`;
    if (labelsQ.exitCode !== 0) {
      return;
    }
    const labelsOut = String(labelsQ.stdout || "");
    assert.ok(
      labelsOut.includes("patch_scope:importer-local"),
      "expected patch_scope:importer-local label present on nix_python_binary target",
    );

    const resQ = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute resources //apps/demo:bin__patch_inputs`;
    if (resQ.exitCode !== 0) {
      return;
    }
    const resOut = String(resQ.stdout || "");
    assert.ok(
      resOut.includes(patchRel),
      "expected synthetic dep to include importer-local patch in resources",
    );
  });
});
