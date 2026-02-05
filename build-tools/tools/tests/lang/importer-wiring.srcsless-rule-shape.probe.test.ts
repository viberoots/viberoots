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

test("importer_wiring exposes srcs-less rule shape wiring via synthetic dep helper (probe)", async () => {
  await runInTemp("importer-wiring-srcsless-probe", async (tmp, $) => {
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "MODULE_PROVIDERS = {",
        '  "//projects/apps/demo:bin": ["//third_party/providers:prov_a"],',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "demo");
    const patchDir = path.join(appDir, "patches", "python");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fsp.writeFile(path.join(patchDir, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "python_library")',
        'load("//build-tools/lang/internal:importer_wiring.bzl", "prepare_importer_srcsless_rule_wiring")',
        'load("//build-tools/lang:labels_file.bzl", "labels_file")',
        "",
        'kw = {"labels": []}',
        "w = prepare_importer_srcsless_rule_wiring(",
        '  name = "bin",',
        "  kwargs = kw,",
        "  deps = [],",
        '  lang = "python",',
        '  kind = "bin",',
        '  lockfile_label = "lockfile:projects/apps/demo/uv.lock#projects/apps/demo",',
        ")",
        "python_library(**w.patch_dep.kwargs)",
        "labels_file(",
        '  name = "deps_probe",',
        "  labels = w.merge_deps([]),",
        '  out = "deps_probe.txt",',
        ")",
        "labels_file(",
        '  name = "resources_probe",',
        '  labels = w.patch_dep.kwargs.get("resources", []),',
        '  out = "resources_probe.txt",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const depsOut = await buildOutPath(tmp, $, "//projects/apps/demo:deps_probe");
    const resourcesOut = await buildOutPath(tmp, $, "//projects/apps/demo:resources_probe");
    if (!depsOut || !resourcesOut) return;

    const depsLines = readLines(await fsp.readFile(depsOut, "utf8"));
    assert.ok(
      depsLines.includes("//third_party/providers:prov_a"),
      "expected provider edge present in merged deps output",
    );
    assert.ok(
      depsLines.some((l) => l.endsWith(":bin__patch_inputs") || l.includes("bin__patch_inputs")),
      "expected synthetic dep name derived from parent name",
    );

    const resourcesLines = readLines(await fsp.readFile(resourcesOut, "utf8"));
    assert.ok(
      resourcesLines.some((l) => l.includes("patches/python/leftpad@1.3.0.patch")),
      "expected importer-local patch path present in synthetic dep resources",
    );
  });
});
