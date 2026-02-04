#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("wasm-package-local-wiring-non-mutating-probe", async (tmp, $) => {
  const pkg = path.join(tmp, "libs", "demo");
  await fsp.mkdir(pkg, { recursive: true });

  await fsp.writeFile(
    path.join(pkg, "TARGETS"),
    [
      'load("//build-tools/lang:defs_common.bzl", "package_local_wasm_wiring_mutation_probe")',
      "",
      "package_local_wasm_wiring_mutation_probe(",
      '  name = "probe",',
      '  lang = "go",',
      '  variant = "tinygo",',
      '  local_patch_dirs = ["patches/go"],',
      '  nixpkg_deps = ["zlib"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output //libs/demo:probe`.nothrow();
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
    "pre_has:local_patch_dirs:true",
    "post_has:local_patch_dirs:true",
    "pre_has:nixpkg_deps:true",
    "post_has:nixpkg_deps:true",
    "post_labels_same:true",
  ];
  for (const w of want) {
    assert.ok(lines.includes(w), `expected probe output line: ${w}`);
  }
});
