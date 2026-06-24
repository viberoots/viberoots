#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("nix_cpp_test follows transitive link_deps with link_closure=transitive", async () => {
  await runInTemp("cpp-test-link-closure-transitive", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "include", "support.h"),
      ["#pragma once", "int support_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "src", "support.cpp"),
      ['#include "../include/support.h"', "int support_answer() { return 2; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_headers", "nix_cpp_library")',
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
      path.join(tmp, "projects", "libs", "core", "include", "core.h"),
      ["#pragma once", "int core_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "core", "src", "core.cpp"),
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
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
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
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_test")',
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_test_link_closure")} cquery --target-platforms prelude//platforms:default "deps(//projects/apps/demo:t)" --json --output-attribute name`;
    assert.equal(probe.exitCode, 0, String(probe.stderr || probe.stdout));

    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $({
      cwd: tmp,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_test_link_closure")} test --target-platforms prelude//platforms:default //projects/apps/demo:t`;
  });
});
