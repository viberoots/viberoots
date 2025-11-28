#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-include-pkg-local-patches", async (tmp, $) => {
  // Minimal provider mapping to satisfy loads in macros where needed
  await fs.mkdirp(path.join(tmp, "third_party/providers"));
  await fs.writeFile(
    path.join(tmp, "third_party/providers/auto_map.bzl"),
    "MODULE_PROVIDERS = {}\n",
    "utf8",
  );

  // Minimal C++ lib with package-local patches
  const pkg = path.join(tmp, "libs/demo");
  await fs.mkdirp(path.join(pkg, "patches/cpp"));
  await fs.writeFile(path.join(pkg, "patches/cpp", "x@0.0.1.patch"), "# x\n", "utf8");
  await fs.writeFile(path.join(pkg, "patches/cpp", "y@2.3.4.patch"), "# y\n", "utf8");
  await fs.mkdirp(path.join(pkg, "src"));
  await fs.writeFile(
    path.join(pkg, "src", "demo.cpp"),
    "int add(int a,int b){return a+b;}\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(pkg, "TARGETS"),
    [
      'load("//lang:defs_common.bzl", "package_local_patches_probe")',
      "",
      "package_local_patches_probe(",
      '  name = "probe_cpp",',
      '  lang = "cpp",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --show-output //libs/demo:probe_cpp`.nothrow();
  assert.equal(so.exitCode, 0, "buck2 build --show-output failed for probe_cpp");
  const outLine = String(so.stdout || "").trim();
  assert.match(
    outLine,
    /probe_cpp\.srcs\.txt/,
    "expected probe_cpp.srcs.txt output to be produced",
  );
});
