#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("importer-wiring-non-mutating-probe", async (tmp, $) => {
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
      'load("//lang:defs_common.bzl", "importer_wiring_mutation_probe")',
      "",
      "importer_wiring_mutation_probe(",
      '  name = "probe",',
      '  lang = "python",',
      '  kind = "lib",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output //apps/demo:probe`.nothrow();
  assert.equal(so.exitCode, 0, "buck2 build --show-output failed for probe");
  const outLine = String(so.stdout || "").trim();
  const outPath = outLine.split(/\s+/).pop()!;
  const absOutPath = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
  const contents = await fsp.readFile(absOutPath, "utf8");
  const lines = contents
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const want = [
    "pre:srcs:false",
    "post:srcs:false",
    "pre:labels_has_patch_scope:false",
    "post:labels_has_patch_scope:false",
    "pre:labels_has_lockfile:false",
    "post:labels_has_lockfile:false",
  ];
  for (const w of want) {
    assert.ok(lines.includes(w), `expected probe output line: ${w}`);
  }
});
