#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("planner-visible-package-local-wiring-v2-non-mutating-probe", async (tmp, $) => {
  const appDir = path.join(tmp, "apps", "probe");
  await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });
  await fsp.writeFile(path.join(appDir, "patches", "cpp", "demo@0.0.0.patch"), "# noop\n", "utf8");

  await fsp.writeFile(
    path.join(appDir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("//lang:defs_common.bzl", "wire_package_local_planner_visible_stub_v2")',
      "",
      'kw = {"labels": ["probe:v2"], "local_patch_dirs": ["patches/cpp"], "nixpkg_deps": ["zlib"]}',
      'pre_local = "local_patch_dirs" in kw',
      'pre_nix = "nixpkg_deps" in kw',
      "",
      "wire_package_local_planner_visible_stub_v2(",
      '  name = "stub",',
      '  out = "stub.stamp",',
      "  kwargs = kw,",
      '  lang = "cpp",',
      '  kind = "test",',
      "  deps = [],",
      "  srcs = [],",
      ")",
      "",
      'post_local = "local_patch_dirs" in kw',
      'post_nix = "nixpkg_deps" in kw',
      "",
      "genrule(",
      '  name = "probe",',
      '  out = "probe.items.txt",',
      "  cmd = \"cat > $OUT <<'EOF'\\n\" +",
      '    "pre_has:local_patch_dirs:" + ("true" if pre_local else "false") + "\\n" +',
      '    "post_has:local_patch_dirs:" + ("true" if post_local else "false") + "\\n" +',
      '    "pre_has:nixpkg_deps:" + ("true" if pre_nix else "false") + "\\n" +',
      '    "post_has:nixpkg_deps:" + ("true" if post_nix else "false") + "\\n" +',
      '    "EOF"',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output //apps/probe:probe`.nothrow();
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
  ];
  for (const w of want) {
    assert.ok(lines.includes(w), `expected probe output line: ${w}`);
  }
});
