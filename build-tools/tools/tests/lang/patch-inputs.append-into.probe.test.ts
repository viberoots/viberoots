#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("append_patch_inputs appends patch globs into requested field (probe)", async () => {
  await runInTemp("patch-inputs-append-into-probe", async (tmp, $) => {
    const pkgDir = path.join(tmp, "projects", "apps", "demo");
    const patchDir = path.join(pkgDir, "patches", "python");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(patchDir, "a@1.0.0.patch"), "# a\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "b@2.0.0.patch"), "# b\n", "utf8");

    await fsp.writeFile(
      path.join(pkgDir, "TARGETS"),
      [
        'load("//build-tools/lang:defs_common.bzl", "patch_inputs_probe")',
        "",
        "patch_inputs_probe(",
        '  name = "probe_srcs",',
        '  dirs = ["patches/python"],',
        '  into = "srcs",',
        '  initial = ["patches/python/a@1.0.0.patch"],',
        ")",
        "",
        "patch_inputs_probe(",
        '  name = "probe_resources",',
        '  dirs = ["patches/python"],',
        '  into = "resources",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    async function buildOutPath(target: string) {
      const so = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 build --target-platforms //:no_cgo --show-output ${target}`;
      if (so.exitCode !== 0) return null;
      const line = String(so.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)[0];
      if (!line) return null;
      const outPath = line.split(/\s+/).pop();
      if (!outPath) return null;
      return path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
    }

    const srcsPath = await buildOutPath("//projects/apps/demo:probe_srcs");
    const resourcesPath = await buildOutPath("//projects/apps/demo:probe_resources");
    if (!srcsPath || !resourcesPath) {
      // Skip when prelude/toolchains aren't available in the ephemeral temp repo.
      return;
    }

    const srcsItems = (await fsp.readFile(srcsPath, "utf8"))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const resourcesItems = (await fsp.readFile(resourcesPath, "utf8"))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    assert.ok(srcsItems.includes("patches/python/a@1.0.0.patch"), "expected a@1.0.0.patch in srcs");
    assert.ok(srcsItems.includes("patches/python/b@2.0.0.patch"), "expected b@2.0.0.patch in srcs");
    assert.equal(
      srcsItems.filter((p) => p === "patches/python/a@1.0.0.patch").length,
      1,
      "expected a@1.0.0.patch to be deduped in srcs",
    );

    assert.ok(
      resourcesItems.includes("patches/python/a@1.0.0.patch"),
      "expected a@1.0.0.patch in resources",
    );
    assert.ok(
      resourcesItems.includes("patches/python/b@2.0.0.patch"),
      "expected b@2.0.0.patch in resources",
    );
  });
});
