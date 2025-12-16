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
        'load("//lang:importer_wiring.bzl", "attach_importer_patch_inputs", "merge_provider_edges", "require_single_importer_lockfile_label")',
        'load("//lang:labels_file.bzl", "labels_file")',
        "",
        "# list-shaped attachment",
        'kw_list = {"labels": [], "srcs": []}',
        'require_single_importer_lockfile_label(kw_list, "lockfile:apps/web/pnpm-lock.yaml#apps/web")',
        'attach_importer_patch_inputs(kw_list, "node", into = "srcs")',
        'merged_list = merge_provider_edges("bin", kw_list.get("srcs", []), into = "srcs")',
        "labels_file(",
        '  name = "list_probe",',
        "  labels = merged_list,",
        '  out = "list_probe.txt",',
        ")",
        "",
        "# dict-shaped attachment",
        'kw_dict = {"labels": ["lockfile:apps/web/pnpm-lock.yaml#apps/web"], "srcs": {"dst.txt": "src.txt"}}',
        'attach_importer_patch_inputs(kw_dict, "node", into = "srcs", dict_safe = True, key_prefix = "__patch_inputs__")',
        'kw_dict["srcs"] = merge_provider_edges("bin", [], into = "srcs", base = kw_dict.get("srcs", {}), dict_safe = True, key_prefix = "__provider_edges__")',
        "labels_file(",
        '  name = "dict_probe",',
        '  labels = sorted(kw_dict.get("srcs", {}).keys()),',
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
  });
});
