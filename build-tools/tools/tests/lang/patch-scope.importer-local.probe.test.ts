#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function readLines(txt: string): string[] {
  return txt
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function buildOutPath(tmp: string, $: any, target: string): Promise<string> {
  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output ${target}`.nothrow();
  assert.equal(so.exitCode, 0, `buck2 build --show-output failed for ${target}`);
  const line = String(so.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)[0];
  const outPath = line.split(/\s+/).pop();
  assert.ok(outPath, "missing show-output path");
  return path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
}

test("importer-scoped wiring stamps patch_scope:importer-local exactly once (probe)", async () => {
  await runInTemp("patch-scope-importer-local-probe", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "MODULE_PROVIDERS = {}\n",
      "utf8",
    );

    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "patches", "python"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "uv.lock"), "# uv lock\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "patches", "python", "hello@1.0.0.patch"),
      "# noop\n",
      "utf8",
    );

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "python_library")',
        'load("//build-tools/lang:defs_common.bzl", "prepare_language_wiring")',
        'load("//build-tools/lang:labels_file.bzl", "labels_file")',
        "",
        'kw = {"labels": ["patch_scope:package-local", "custom:tag"]}',
        "w = prepare_language_wiring(",
        '  name = "bin",',
        "  kwargs = kw,",
        "  deps = [],",
        '  lang = "python",',
        '  kind = "lib",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        "  MODULE_PROVIDERS = {},",
        '  wiring = "non_genrule",',
        ")",
        "python_library(deps = w.deps, **w.kwargs)",
        "labels_file(",
        '  name = "labels_probe",',
        '  labels = w.kwargs.get("labels", []),',
        '  out = "labels_probe.txt",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const outPath = await buildOutPath(tmp, $, "//apps/demo:labels_probe");
    const labels = readLines(await fsp.readFile(outPath, "utf8"));
    const patchScopes = labels.filter((l) => l.startsWith("patch_scope:"));
    assert.deepEqual(
      patchScopes,
      ["patch_scope:importer-local"],
      "expected exactly one patch_scope label",
    );
  });
});
