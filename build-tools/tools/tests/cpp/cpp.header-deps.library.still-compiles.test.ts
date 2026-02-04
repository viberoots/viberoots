#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp: header_deps on a library still compiles with header-only usage", async () => {
  await runInTemp("cpp-header-deps-library-compiles", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "dep", "src", "dep.cpp"),
      ['#include "dep.h"', "int dep_answer() { return 11; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "dep", "include", "dep.h"),
      ["#pragma once", "inline int dep_inline() { return 11; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "dep", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "dep",',
        '  srcs = ["src/dep.cpp", "include/dep.h"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      ["#include <dep.h>", "int main() {", "  return dep_inline() == 11 ? 0 : 1;", "}", ""].join(
        "\n",
      ),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  header_deps = ["//libs/dep:dep"],',
        '  labels = ["lang:cpp", "kind:bin"],',
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
    })`buck2 --isolation-dir cpp_header_deps_lib_compiles cquery "deps(//apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//apps/demo:demo" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));
  });
});
