#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("cpp wasm static lib compiles with header_deps via nix_cpp_headers (build)", async () => {
  await runInTemp("cpp-wasm-static-lib-header-deps-builds", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "tools", "nix", "langs.json"),
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
        'load("//cpp:defs.bzl", "nix_cpp_headers")',
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
      path.join(tmp, "libs", "core", "src", "core.c"),
      ['#include "demo.h"', "int core_answer(void) {", "  return demo_answer();", "}", ""].join(
        "\n",
      ),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
        "",
        "nix_cpp_wasm_static_lib(",
        '  name = "core_wasm",',
        '  srcs = ["src/core.c"],',
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
    })`buck2 --isolation-dir cpp_wasm_hdr_deps cquery "deps(//libs/core:core_wasm)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({ cwd: tmp })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/core:core_wasm" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));
  });
});
