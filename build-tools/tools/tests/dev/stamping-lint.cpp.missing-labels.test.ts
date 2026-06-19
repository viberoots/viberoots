#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("stamping-lint-cpp-missing", async (tmp, $) => {
  const env = { ...process.env };
  const lib = path.join(tmp, "libs", "demo");
  await fs.mkdirp(lib);
  await fs.outputFile(
    path.join(lib, "TARGETS"),
    ["cxx_library(", '  name = "demo",', '  srcs = ["demo.cpp"],', ")", ""].join("\n"),
    "utf8",
  );
  await fs.outputFile(path.join(lib, "demo.cpp"), "int add(int a,int b){return a+b;}\n");
  const res = await $({
    cwd: tmp,
    quiet: true,
    env,
  })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/dev/stamping-lint.ts`.nothrow();
  const out = String(res.stdout || "") + String(res.stderr || "");
  assert.notEqual(res.exitCode, 0);
  assert.match(out, /missing label lang:cpp/);

  // Now switch to macro which stamps labels
  await fs.outputFile(
    path.join(lib, "TARGETS"),
    [
      'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
      "nix_cpp_library(",
      '  name = "demo",',
      '  srcs = ["demo.cpp"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputFile(
    path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"),
    await fs.readFile("viberoots/build-tools/cpp/defs.bzl", "utf8"),
  );
  await fs.outputFile(
    path.join(tmp, "viberoots", "build-tools", "cpp", "wasm_defs.bzl"),
    await fs.readFile("viberoots/build-tools/cpp/wasm_defs.bzl", "utf8"),
  );
  await $({
    cwd: tmp,
    quiet: true,
    env,
  })`buck2 kill`.nothrow();
  const res2 = await $({
    cwd: tmp,
    quiet: true,
    env,
  })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/dev/stamping-lint.ts`;
  const out2 = String(res2.stdout || "") + String(res2.stderr || "");
  assert.match(out2, /stamping-lint: OK/);
});
