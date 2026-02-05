#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_test follows transitive link_deps with link_closure=transitive", async () => {
  await runInTemp("cpp-test-link-closure-transitive", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "support", "include", "support.h"),
      ["#pragma once", "int support_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "support", "src", "support.cpp"),
      ['#include "../include/support.h"', "int support_answer() { return 2; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "support", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_headers", "nix_cpp_library")',
        "",
        "nix_cpp_headers(",
        '  name = "headers",',
        '  srcs = ["include/support.h"],',
        '  labels = ["lang:cpp", "kind:headers"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_library(",
        '  name = "support",',
        '  srcs = ["src/support.cpp", "include/support.h"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "include", "core.h"),
      ["#pragma once", "int core_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      [
        '#include "../include/core.h"',
        "#include <support.h>",
        "int core_answer() {",
        "  return support_answer() + 8;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "core", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp", "include/core.h"],',
        '  link_deps = ["//projects/libs/support:support"],',
        '  header_deps = ["//projects/libs/support:headers"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "projects", "apps", "demo", "tests", "t.cpp"),
      [
        "#include <gtest/gtest.h>",
        "#include <core.h>",
        "",
        "TEST(Demo, LinksCoreTransitive) {",
        "  EXPECT_EQ(core_answer(), 10);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "demo", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_test")',
        "",
        "nix_cpp_test(",
        '  name = "t",',
        '  srcs = ["tests/t.cpp"],',
        '  link_deps = ["//projects/libs/core:core"],',
        '  link_closure = "transitive",',
        '  nixpkg_deps = ["pkgs.googletest"],',
        '  labels = ["lang:cpp", "kind:test"],',
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
    })`buck2 --isolation-dir cpp_test_link_closure cquery "deps(//projects/apps/demo:t)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    await $({ cwd: tmp })`buck2 --isolation-dir cpp_test_link_closure test //projects/apps/demo:t`;
  });
});
