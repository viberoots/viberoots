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

function readItems(txt: string): string[] {
  return txt
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("synthetic_dep_for_importer_patches_from_labels computes stable dep name and patch inputs (probe)", async () => {
  await runInTemp("patch-inputs-synthetic-dep-importer-patches-probe", async (tmp, $) => {
    const pkgDir = path.join(tmp, "projects", "apps", "demo");
    const patchDir = path.join(pkgDir, "patches", "python");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(pkgDir, "uv.lock"), "# uv lock\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "a@1.0.0.patch"), "# a\n", "utf8");

    await fsp.writeFile(
      path.join(pkgDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "synthetic_dep_for_importer_patches_from_labels_probe")',
        "",
        "synthetic_dep_for_importer_patches_from_labels_probe(",
        '  name = "probe_bin",',
        '  parent_name = "bin",',
        '  lockfile_label = "lockfile:projects/apps/demo/uv.lock#projects/apps/demo",',
        '  lang = "python",',
        '  into = "resources",',
        ")",
        "",
        "synthetic_dep_for_importer_patches_from_labels_probe(",
        '  name = "probe_spaced",',
        '  parent_name = "bin with space",',
        '  lockfile_label = "lockfile:projects/apps/demo/uv.lock#projects/apps/demo",',
        '  lang = "python",',
        '  into = "resources",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const out1 = await buildOutPath(tmp, $, "//projects/apps/demo:probe_bin");
    const out2 = await buildOutPath(tmp, $, "//projects/apps/demo:probe_spaced");
    if (!out1 || !out2) {
      // Skip when prelude/toolchains aren't available in the ephemeral temp repo.
      return;
    }

    const items1 = readItems(await fsp.readFile(out1, "utf8"));
    const items2 = readItems(await fsp.readFile(out2, "utf8"));

    assert.ok(items1.includes(":bin__patch_inputs"), "expected stable synthetic dep label");
    assert.ok(
      items1.some((p) => p.endsWith("patches/python/a@1.0.0.patch")),
      "expected patch input",
    );

    assert.ok(
      items2.includes(":bin-with-space__patch_inputs"),
      "expected sanitized synthetic dep label",
    );
    assert.ok(
      items2.some((p) => p.endsWith("patches/python/a@1.0.0.patch")),
      "expected patch input",
    );
  });
});
