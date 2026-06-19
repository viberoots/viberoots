#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("go-include-pkg-local-patches", async (tmp, $) => {
  // Prepare minimal provider mapping to satisfy macro load
  await fs.mkdirp(path.join(tmp, "third_party/providers"));
  await fs.writeFile(
    path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl"),
    "MODULE_PROVIDERS = {}\n",
    "utf8",
  );

  // Minimal Go lib with package-local patches
  const pkg = path.join(tmp, "projects/libs/demo");
  await fs.mkdirp(path.join(pkg, "patches/go"));
  await fs.writeFile(path.join(pkg, "patches/go", "a@1.0.0.patch"), "# a\n", "utf8");
  await fs.writeFile(path.join(pkg, "patches/go", "b@1.2.3.patch"), "# b\n", "utf8");
  await fs.mkdirp(path.join(pkg, "src"));
  await fs.writeFile(
    path.join(pkg, "src", "demo.go"),
    "package demo\nfunc Add(a,b int) int { return a+b }\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(pkg, "TARGETS"),
    [
      'load("@viberoots//build-tools/lang:defs_common.bzl", "package_local_patches_probe")',
      "",
      "package_local_patches_probe(",
      '  name = "probe_go",',
      '  lang = "go",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --show-output //projects/libs/demo:probe_go`.nothrow();
  assert.equal(so.exitCode, 0, "buck2 build --show-output failed for probe_go");
  const outLine = String(so.stdout || "").trim();
  assert.match(outLine, /probe_go\.srcs\.txt/, "expected probe_go.srcs.txt output to be produced");
  // Parse output artifact path and validate contents include expected patch files
  const outPath = outLine.split(/\s+/).pop()!;
  const absOutPath = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
  const contents = await fs.readFile(absOutPath, "utf8");
  const lines = contents
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(lines.includes("patches/go/a@1.0.0.patch"), "missing a@1.0.0.patch in srcs");
  assert.ok(lines.includes("patches/go/b@1.2.3.patch"), "missing b@1.2.3.patch in srcs");
});
