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

test("prepare_importer_nix_calling_genrule_wiring composes patches, provider edges, global inputs, and workspace-root.env injection (probe)", async () => {
  await runInTemp("importer-nix-calling-genrule-wiring-probe", async (tmp, $) => {
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
        'load("//build-tools/lang/internal:nix_calling_importer_genrule_wiring.bzl", "prepare_importer_nix_calling_genrule_wiring")',
        'load("//build-tools/lang:labels_file.bzl", "labels_file")',
        "",
        "# list-shaped srcs",
        'kw_list = {"labels": [], "srcs": []}',
        "w_list = prepare_importer_nix_calling_genrule_wiring(",
        '  name = "bin",',
        "  kwargs = kw_list,",
        "  srcs = [],",
        "  deps = [],",
        '  lang = "node",',
        '  kind = "gen",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        "  inject_workspace_root_env = False,",
        '  global_inputs_into = "srcs",',
        "  global_inputs_stamp = True,",
        ")",
        "labels_file(",
        '  name = "list_probe",',
        '  labels = w_list.kwargs.get("srcs", []),',
        '  out = "list_probe.txt",',
        ")",
        "",
        "# dict-shaped srcs",
        'kw_dict = {"labels": [], "srcs": {"dst.txt": "src.txt"}}',
        "w_dict = prepare_importer_nix_calling_genrule_wiring(",
        '  name = "bin",',
        "  kwargs = kw_dict,",
        '  srcs = {"dst.txt": "src.txt"},',
        "  deps = [],",
        '  lang = "node",',
        '  kind = "gen",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        "  inject_workspace_root_env = True,",
        ")",
        "labels_file(",
        '  name = "dict_probe",',
        '  labels = sorted(w_dict.kwargs.get("srcs", {}).keys()),',
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
      "expected importer patch path present in list-shaped srcs",
    );
    assert.ok(
      listLines.includes("//third_party/providers:prov_a"),
      "expected provider edge present in list-shaped srcs",
    );
    assert.ok(
      listLines.includes("//:flake.lock"),
      "expected global nix input present in list-shaped srcs",
    );

    const dictKeys = readLines(await fsp.readFile(dictOut, "utf8"));
    assert.ok(
      dictKeys.includes("dst.txt"),
      "expected caller mapping preserved in dict-shaped srcs",
    );
    assert.ok(
      dictKeys.includes("build-tools/tools/buck/workspace-root.env"),
      "expected workspace-root.env injected into dict-shaped srcs",
    );
    assert.ok(
      dictKeys.some((k) => k.startsWith("__patch_inputs__/")),
      "expected __patch_inputs__/ synthetic key in dict-shaped srcs",
    );
    assert.ok(
      dictKeys.some((k) => k.startsWith("__provider_edges__/")),
      "expected __provider_edges__/ synthetic key in dict-shaped srcs",
    );
    assert.ok(
      dictKeys.some((k) => k.startsWith("__global_nix_inputs__/")),
      "expected __global_nix_inputs__/ synthetic key in dict-shaped srcs",
    );
  });
});
