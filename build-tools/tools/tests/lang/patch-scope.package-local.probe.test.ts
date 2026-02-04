#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("patch-scope-package-local-probe", async (tmp, $) => {
  const pkg = path.join(tmp, "libs", "demo");
  await fsp.mkdir(path.join(pkg, "patches", "go"), { recursive: true });
  await fsp.writeFile(path.join(pkg, "patches", "go", "a@1.0.0.patch"), "# a\n", "utf8");

  await fsp.writeFile(
    path.join(pkg, "TARGETS"),
    [
      'load("//build-tools/lang:defs_common.bzl", "prepare_language_wiring")',
      'load("//build-tools/lang:labels_file.bzl", "labels_file")',
      "",
      'kw = {"labels": ["patch_scope:importer-local", "patch_scope:package-local", "custom:tag"]}',
      "w = prepare_language_wiring(",
      '  name = "probe",',
      "  kwargs = kw,",
      '  lang = "go",',
      '  kind = "lib",',
      "  MODULE_PROVIDERS = {},",
      "  deps = [],",
      ")",
      "labels_file(",
      '  name = "labels_probe",',
      '  labels = w.kwargs.get("labels", []),',
      '  out = "labels_probe.txt",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output //libs/demo:labels_probe`.nothrow();
  assert.equal(so.exitCode, 0, "buck2 build --show-output failed for labels probe");

  const outLine = String(so.stdout || "").trim();
  const outPath = outLine.split(/\s+/).pop()!;
  const absOutPath = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
  const labels = (await fsp.readFile(absOutPath, "utf8"))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const patchScopes = labels.filter((l) => l.startsWith("patch_scope:"));
  assert.deepEqual(
    patchScopes,
    ["patch_scope:package-local"],
    "expected exactly one patch_scope label",
  );
});
