#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("stamping-lint-cpp-missing", async (tmp, $) => {
  const iso1 = `stamping-lint-1-${process.pid}-${Date.now()}`;
  const iso2 = `stamping-lint-2-${process.pid}-${Date.now()}`;
  const env1 = { ...process.env, BUCK_ISOLATION_DIR: iso1 };
  const env2 = { ...process.env, BUCK_ISOLATION_DIR: iso2 };
  const lib = path.join(tmp, "libs", "demo");
  await fs.mkdirp(lib);
  await fs.outputFile(
    path.join(lib, "TARGETS"),
    ["cxx_library(", '  name = "demo",', '  srcs = ["demo.cpp"],', ")", ""].join("\n"),
    "utf8",
  );
  await fs.outputFile(path.join(lib, "demo.cpp"), "int add(int a,int b){return a+b;}\n");
  try {
    const res = await $({
      cwd: tmp,
      quiet: true,
      env: env1,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/dev/stamping-lint.ts`.nothrow();
    const out = String(res.stdout || "") + String(res.stderr || "");
    assert.notEqual(res.exitCode, 0);
    assert.match(out, /missing label lang:cpp/);
  } finally {
    await $({
      cwd: tmp,
      env: env1,
      stdio: "ignore",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${iso1} kill`;
  }

  // Now switch to macro which stamps labels
  await fs.outputFile(
    path.join(lib, "TARGETS"),
    [
      'load("//cpp:defs.bzl", "nix_cpp_library")',
      "nix_cpp_library(",
      '  name = "demo",',
      '  srcs = ["demo.cpp"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputFile(path.join(tmp, "cpp", "defs.bzl"), await fs.readFile("cpp/defs.bzl", "utf8"));
  await fs.outputFile(
    path.join(tmp, "cpp", "wasm_defs.bzl"),
    await fs.readFile("cpp/wasm_defs.bzl", "utf8"),
  );
  try {
    const res2 = await $({
      cwd: tmp,
      quiet: true,
      env: env2,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/dev/stamping-lint.ts`;
    const out2 = String(res2.stdout || "") + String(res2.stderr || "");
    assert.match(out2, /stamping-lint: OK/);
  } finally {
    await $({
      cwd: tmp,
      env: env2,
      stdio: "ignore",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${iso2} kill`;
  }
});
