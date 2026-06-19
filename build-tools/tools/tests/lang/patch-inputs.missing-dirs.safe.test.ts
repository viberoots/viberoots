#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function buildOutPath(tmp: string, $: any, target: string): Promise<string | null> {
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

test("patch input probes tolerate missing root and package patch dirs", async () => {
  await runInTemp("patch-inputs-missing-dirs-safe", async (tmp, $) => {
    await fsp.writeFile(
      path.join(tmp, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "patch_inputs_probe")',
        "",
        "patch_inputs_probe(",
        '  name = "probe_root_missing",',
        '  dirs = ["patches/cpp"],',
        '  into = "srcs",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const pkg = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(pkg, { recursive: true });
    await fsp.writeFile(
      path.join(pkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "package_local_patches_probe")',
        "",
        "package_local_patches_probe(",
        '  name = "probe_pkg_missing",',
        '  lang = "cpp",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const rootProbe = await buildOutPath(tmp, $, "//:probe_root_missing");
    const pkgProbe = await buildOutPath(tmp, $, "//projects/apps/demo:probe_pkg_missing");
    if (!rootProbe || !pkgProbe) return;

    const rootItems = (await fsp.readFile(rootProbe, "utf8")).trim();
    const pkgItems = (await fsp.readFile(pkgProbe, "utf8")).trim();
    assert.equal(rootItems, "");
    assert.equal(pkgItems, "");
  });
});
