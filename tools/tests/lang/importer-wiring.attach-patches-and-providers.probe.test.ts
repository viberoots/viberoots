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

test("importer_wiring attaches importer patches and merges provider edges for list+dict shapes (probe)", async () => {
  await runInTemp("importer-wiring-attach-and-merge-probe", async (tmp, $) => {
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "MODULE_PROVIDERS = {",
        '  "//apps/web:bin": ["//third_party/providers:prov_a"],',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//lang:defs_common.bzl", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")',
        'load("//lang/internal:importer_wiring.bzl", "prepare_importer_genrule_kwargs")',
        'load("//lang:labels_file.bzl", "labels_file")',
        "",
        "# list-shaped attachment (prepared kwargs for genrule-style macros)",
        'kw_list = {"labels": [], "srcs": []}',
        "prepared_list = prepare_importer_genrule_kwargs(",
        '  name = "bin",',
        "  kwargs = kw_list,",
        "  srcs = [],",
        "  deps = [],",
        '  lang = "node",',
        '  kind = "gen",',
        "  labels = [],",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        ")",
        "labels_file(",
        '  name = "list_probe",',
        '  labels = prepared_list.kwargs.get("srcs", []),',
        '  out = "list_probe.txt",',
        ")",
        "",
        "# dict-shaped attachment (preserve caller mapping, add synthetic keys)",
        'kw_dict = {"labels": [], "srcs": {"dst.txt": "src.txt"}}',
        "prepared_dict = prepare_importer_genrule_kwargs(",
        '  name = "bin",',
        "  kwargs = kw_dict,",
        '  srcs = {"dst.txt": "src.txt"},',
        "  deps = [],",
        '  lang = "node",',
        '  kind = "gen",',
        "  labels = [],",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        "  patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,",
        "  provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,",
        ")",
        "labels_file(",
        '  name = "dict_probe",',
        '  labels = sorted(prepared_dict.kwargs.get("srcs", {}).keys()),',
        '  out = "dict_probe.txt",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const listOut = await buildOutPath(tmp, $, "//apps/web:list_probe");
    const dictOut = await buildOutPath(tmp, $, "//apps/web:dict_probe");
    if (!listOut || !dictOut) return;

    const listLines = readLines(await fsp.readFile(listOut, "utf8"));
    assert.ok(
      listLines.some((l) => l.includes("patches/node/leftpad@1.3.0.patch")),
      "expected importer patch path present in merged list output",
    );
    assert.ok(
      listLines.includes("//third_party/providers:prov_a"),
      "expected provider edge present in merged list output",
    );

    const dictKeys = readLines(await fsp.readFile(dictOut, "utf8"));
    assert.ok(
      dictKeys.some((k) => k.startsWith("__patch_inputs__/")),
      "expected __patch_inputs__/ synthetic key in dict-shaped attachment",
    );
    assert.ok(
      dictKeys.some((k) => k.startsWith("__provider_edges__/")),
      "expected __provider_edges__/ synthetic key in dict-shaped attachment",
    );
    assert.ok(
      dictKeys.includes("dst.txt"),
      "expected caller mapping preserved in dict-shaped srcs",
    );
  });
});
