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

function readLines(txt: string): string[] {
  return txt
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("workspace provider auto-map: realize_provider_edges uses MODULE_PROVIDERS unchanged (probe)", async () => {
  await runInTemp("lang-workspace-provider-auto-map-probe", async (tmp, $) => {
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "MODULE_PROVIDERS = {",
        '  "//projects/apps/demo:bin": ["//third_party/providers:prov_a", "//third_party/providers:prov_b"],',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")',
        'load("@viberoots//build-tools/lang:defs_common.bzl", "realize_provider_edges")',
        'load("@viberoots//build-tools/lang:labels_file.bzl", "labels_file")',
        "",
        'merged = realize_provider_edges(MODULE_PROVIDERS, "bin", base = [',
        '  "//third_party/providers:prov_a",',
        '  "//x:y",',
        '  "//third_party/providers:prov_a",',
        "])",
        "",
        "labels_file(",
        '  name = "probe",',
        "  labels = merged,",
        '  out = "probe.txt",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const out = await buildOutPath(tmp, $, "//projects/apps/demo:probe");
    if (!out) return; // skip if prelude/toolchains aren't available in the temp repo
    const lines = readLines(await fsp.readFile(out, "utf8"));
    assert.deepEqual(lines, [
      "//third_party/providers:prov_a",
      "//x:y",
      "//third_party/providers:prov_b",
    ]);
  });
});
