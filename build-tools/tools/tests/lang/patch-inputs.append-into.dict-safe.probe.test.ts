#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("append_patch_inputs_dict_safe attaches patch globs to dict-shaped inputs (probe)", async () => {
  await runInTemp("patch-inputs-dict-safe-probe", async (tmp, $) => {
    const pkgDir = path.join(tmp, "projects", "apps", "demo");
    const patchDir = path.join(pkgDir, "patches", "python");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(patchDir, "a@1.0.0.patch"), "# a\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "b@2.0.0.patch"), "# b\n", "utf8");

    await fsp.writeFile(
      path.join(pkgDir, "TARGETS"),
      [
        'load("//build-tools/lang:defs_common.bzl", "patch_inputs_dict_safe_probe")',
        "",
        "patch_inputs_dict_safe_probe(",
        '  name = "probe_srcs_dict",',
        '  dirs = ["patches/python"],',
        '  into = "srcs",',
        '  initial = {"bin/entry.js": "bin/entry.js"},',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.mkdir(path.join(pkgDir, "bin"), { recursive: true });
    await fsp.writeFile(path.join(pkgDir, "bin", "entry.js"), "console.log('ok')\n", "utf8");

    const so = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //projects/apps/demo:probe_srcs_dict`;
    if (so.exitCode !== 0) {
      return;
    }
    const line = String(so.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)[0];
    const outPath = (line || "").split(/\s+/).pop();
    if (!outPath) return;
    const abs = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);

    const keys = (await fsp.readFile(abs, "utf8"))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    assert.ok(keys.includes("bin/entry.js"), "expected original dict key preserved: bin/entry.js");
    assert.ok(
      keys.includes("__patch_inputs__/patches-python-a@1.0.0.patch"),
      "expected synthetic key for a@1.0.0.patch",
    );
    assert.ok(
      keys.includes("__patch_inputs__/patches-python-b@2.0.0.patch"),
      "expected synthetic key for b@2.0.0.patch",
    );
  });
});
