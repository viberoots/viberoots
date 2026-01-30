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
  assert.equal(so.exitCode, 0, `buck2 build failed for ${target}`);
  const line = String(so.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)[0];
  assert.ok(line, `missing show-output line for ${target}`);
  const outPath = line.split(/\s+/).pop();
  assert.ok(outPath, `missing show-output path for ${target}`);
  return path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
}

test("prepare_language_wiring matches per-model helpers and stays non-mutating", async () => {
  await runInTemp("language-wiring-parity", async (tmp, $) => {
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      [
        "MODULE_PROVIDERS = {",
        '  "//libs/demo:probe": ["//third_party/providers:prov"],',
        '  "//apps/web:probe": ["//third_party/providers:prov"],',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "TARGETS"),
      ['genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])', ""].join(
        "\n",
      ),
      "utf8",
    );

    const pkg = path.join(tmp, "libs", "demo");
    await fsp.mkdir(path.join(pkg, "patches", "go"), { recursive: true });
    await fsp.writeFile(path.join(pkg, "patches", "go", "a@1.0.0.patch"), "# a\n", "utf8");
    await fsp.writeFile(
      path.join(pkg, "TARGETS"),
      [
        'load("//lang:auto_map.bzl", "MODULE_PROVIDERS")',
        'load("//lang:defs_common.bzl", "prepare_language_wiring", "prepare_package_local_wiring")',
        'load("//lang:labels_file.bzl", "labels_file")',
        'load("//lang:language_wiring_probe.bzl", "language_wiring_mutation_probe")',
        "",
        'kw = {"labels": ["custom:tag"]}',
        "w_old = prepare_package_local_wiring(",
        '  name = "probe",',
        "  kwargs = kw,",
        '  lang = "go",',
        '  kind = "lib",',
        "  MODULE_PROVIDERS = MODULE_PROVIDERS,",
        '  base_deps = [":dep_a"],',
        ")",
        "w_new = prepare_language_wiring(",
        '  name = "probe",',
        "  kwargs = kw,",
        '  lang = "go",',
        '  kind = "lib",',
        "  MODULE_PROVIDERS = MODULE_PROVIDERS,",
        '  deps = [":dep_a"],',
        ")",
        'deps_old = ["dep:%s" % d for d in w_old.deps]',
        'labels_old = ["label:%s" % l for l in (w_old.kwargs.get("labels", []) or [])]',
        'srcs_old = ["src:%s" % s for s in (w_old.kwargs.get("srcs", []) or [])]',
        "items_old = deps_old + labels_old + srcs_old",
        'deps_new = ["dep:%s" % d for d in w_new.deps]',
        'labels_new = ["label:%s" % l for l in (w_new.kwargs.get("labels", []) or [])]',
        'srcs_new = ["src:%s" % s for s in (w_new.kwargs.get("srcs", []) or [])]',
        "items_new = deps_new + labels_new + srcs_new",
        "labels_file(",
        '  name = "old",',
        "  labels = items_old,",
        '  out = "old.txt",',
        ")",
        "labels_file(",
        '  name = "new",',
        "  labels = items_new,",
        '  out = "new.txt",',
        ")",
        "language_wiring_mutation_probe(",
        '  name = "mutation_probe",',
        '  lang = "go",',
        '  kind = "lib",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(path.join(appDir, "patches", "node"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "patches", "node", "leftpad@1.3.0.patch"),
      "# noop\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//lang:auto_map.bzl", "MODULE_PROVIDERS")',
        'load("//lang:defs_common.bzl", "prepare_language_wiring", "prepare_importer_non_genrule_wiring")',
        'load("//lang:labels_file.bzl", "labels_file")',
        "",
        'kw = {"labels": ["custom:tag"]}',
        "w_old = prepare_importer_non_genrule_wiring(",
        '  name = "probe",',
        "  kwargs = kw,",
        '  deps = [":dep_a"],',
        '  lang = "node",',
        '  kind = "lib",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        "  MODULE_PROVIDERS = MODULE_PROVIDERS,",
        ")",
        "w_new = prepare_language_wiring(",
        '  name = "probe",',
        "  kwargs = kw,",
        '  deps = [":dep_a"],',
        '  lang = "node",',
        '  kind = "lib",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        "  MODULE_PROVIDERS = MODULE_PROVIDERS,",
        '  wiring = "non_genrule",',
        ")",
        'deps_old = ["dep:%s" % d for d in w_old.deps]',
        'labels_old = ["label:%s" % l for l in (w_old.kwargs.get("labels", []) or [])]',
        'srcs_old = ["src:%s" % s for s in (w_old.kwargs.get("srcs", []) or [])]',
        "items_old = deps_old + labels_old + srcs_old",
        'deps_new = ["dep:%s" % d for d in w_new.deps]',
        'labels_new = ["label:%s" % l for l in (w_new.kwargs.get("labels", []) or [])]',
        'srcs_new = ["src:%s" % s for s in (w_new.kwargs.get("srcs", []) or [])]',
        "items_new = deps_new + labels_new + srcs_new",
        "labels_file(",
        '  name = "old",',
        "  labels = items_old,",
        '  out = "old.txt",',
        ")",
        "labels_file(",
        '  name = "new",',
        "  labels = items_new,",
        '  out = "new.txt",',
        ")",
        "labels_file(",
        '  name = "importer_probe",',
        '  labels = ["importer:%s" % w_new.importer],',
        '  out = "importer.txt",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const demoApp = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(demoApp, "patches", "python"), { recursive: true });
    await fsp.writeFile(path.join(demoApp, "uv.lock"), "# uv lock\n", "utf8");
    await fsp.writeFile(
      path.join(demoApp, "patches", "python", "hello@1.0.0.patch"),
      "# noop\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(demoApp, "TARGETS"),
      [
        'load("//lang:language_wiring_probe.bzl", "language_wiring_mutation_probe")',
        "",
        "language_wiring_mutation_probe(",
        '  name = "mutation_probe",',
        '  lang = "python",',
        '  kind = "lib",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const pkgOld = await buildOutPath(tmp, $, "//libs/demo:old");
    const pkgNew = await buildOutPath(tmp, $, "//libs/demo:new");
    assert.deepEqual(
      readLines(await fsp.readFile(pkgOld, "utf8")),
      readLines(await fsp.readFile(pkgNew, "utf8")),
      "package-local wiring outputs should match",
    );

    const impOld = await buildOutPath(tmp, $, "//apps/web:old");
    const impNew = await buildOutPath(tmp, $, "//apps/web:new");
    assert.deepEqual(
      readLines(await fsp.readFile(impOld, "utf8")),
      readLines(await fsp.readFile(impNew, "utf8")),
      "importer-scoped wiring outputs should match",
    );

    const importerProbe = await buildOutPath(tmp, $, "//apps/web:importer_probe");
    assert.ok(
      readLines(await fsp.readFile(importerProbe, "utf8")).includes("importer:apps/web"),
      "importer should derive from lockfile label",
    );

    const pkgProbe = await buildOutPath(tmp, $, "//libs/demo:mutation_probe");
    const appProbe = await buildOutPath(tmp, $, "//apps/demo:mutation_probe");
    const want = [
      "pre:srcs:false",
      "post:srcs:false",
      "pre:labels_has_patch_scope:false",
      "post:labels_has_patch_scope:false",
      "pre:labels_has_lockfile:false",
      "post:labels_has_lockfile:false",
    ];
    for (const line of want) {
      assert.ok(readLines(await fsp.readFile(pkgProbe, "utf8")).includes(line), `missing ${line}`);
      assert.ok(readLines(await fsp.readFile(appProbe, "utf8")).includes(line), `missing ${line}`);
    }
  });
});
