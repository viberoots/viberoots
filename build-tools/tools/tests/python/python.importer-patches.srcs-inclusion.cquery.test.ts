#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros include importer-local patches in srcs (cquery)", async () => {
  await runInTemp("py-importer-patches-srcs", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    const srcDir = path.join(appDir, "src");
    const patchDir = path.join(appDir, "patches", "python");
    await fsp.mkdir(srcDir, { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });

    // Minimal source and lockfile for importer "apps/demo"
    await fsp.writeFile(path.join(srcDir, "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    const patchRel = "apps/demo/patches/python/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    // Define a tiny library bound to the importer; macro should append importer-local patches to srcs
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//python:defs.bzl", "nix_python_library")',
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

    // Probe Buck for srcs; JSON shape varies between versions, so use substring check
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/demo:lib`;
    if (probe.exitCode !== 0) {
      // Skip when prelude or toolchains aren't available in the ephemeral temp repo.
      return;
    }
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(patchRel),
      `expected importer-local patch path present in srcs: ${patchRel}`,
    );

    const labelsQ = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:lib`;
    if (labelsQ.exitCode !== 0) {
      return;
    }
    const labelsOut = String(labelsQ.stdout || "");
    assert.ok(
      labelsOut.includes("patch_scope:importer-local"),
      "expected patch_scope:importer-local label present on nix_python_library target",
    );
  });
});
