#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_test links an in-repo C++ lib via link_deps (buck2 test)", async () => {
  await runInTemp("cpp-test-links-repo-lib", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "include", "greeter.h"),
      ["#pragma once", "int greeter_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "src", "greeter.cpp"),
      ['#include "../include/greeter.h"', "int greeter_answer() { return 9; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "greeter",',
        '  srcs = ["src/greeter.cpp", "include/greeter.h"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "apps", "demo", "tests", "t.cpp"),
      [
        "#include <gtest/gtest.h>",
        "#include <greeter.h>",
        "",
        "TEST(Demo, LinksGreeter) {",
        "  EXPECT_EQ(greeter_answer(), 9);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_test")',
        "",
        "nix_cpp_test(",
        '  name = "t",',
        '  srcs = ["tests/t.cpp"],',
        '  link_deps = ["//libs/greeter:greeter"],',
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
    })`buck2 --isolation-dir cpp_test_link_deps cquery "deps(//apps/demo:t)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    await $({ cwd: tmp })`buck2 --isolation-dir cpp_test_link_deps test //apps/demo:t`;
  });
});
