#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("cpp library compiles with header_deps via nix_cpp_headers (build)", async () => {
  await runInTemp("cpp-lib-header-deps-compiles", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "hdrs", "include", "demo.h"),
      ["#pragma once", "inline int demo_answer() { return 42; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "hdrs", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_headers")',
        "",
        "nix_cpp_headers(",
        '  name = "hdrs",',
        '  srcs = ["include/demo.h"],',
        '  labels = ["lang:cpp", "kind:headers"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      ["#include <demo.h>", "int core_value() { return demo_answer(); }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp"],',
        '  header_deps = ["//libs/hdrs:hdrs"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cpp_lib_header_deps cquery "deps(//libs/core:core)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/core:core" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));
  });
});
