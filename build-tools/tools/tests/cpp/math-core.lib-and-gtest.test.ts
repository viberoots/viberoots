#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp math-core lib builds and gtest runs", async () => {
  await runInTemp("cpp-math-core", async (tmp, $) => {
    // Create minimal math-core library scaffold in the temp repo
    const libDir = path.join(tmp, "libs", "math-core");
    await fs.outputFile(
      path.join(libDir, "include", "addon.h"),
      `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
#ifdef __cplusplus
extern "C" {
#endif
int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
`,
    );
    await fs.outputFile(
      path.join(libDir, "include", "core", "math.h"),
      `#ifndef MATH_CORE_CORE_MATH_H
#define MATH_CORE_CORE_MATH_H
namespace math_core {
inline int addInts(int a, int b) { return a + b; }
}
#endif
`,
    );
    await fs.outputFile(
      path.join(libDir, "src", "core", "math.cc"),
      `#include "../../include/core/math.h"
namespace math_core {
static int addImpl(int a, int b) { return a + b; }
}
`,
    );
    await fs.outputFile(
      path.join(libDir, "src", "cwrapper", "addon.cc"),
      `#include "../../include/addon.h"
#include "../../include/core/math.h"
extern "C" int add(int a, int b) { return math_core::addInts(a, b); }
`,
    );
    await fs.outputFile(
      path.join(libDir, "tests", "math_core_gtest.cpp"),
      `#include <gtest/gtest.h>
#include "../include/addon.h"
TEST(MathCore, AddWorks) {
  EXPECT_EQ(add(2, 3), 5);
  EXPECT_EQ(add(-4, 4), 0);
  EXPECT_EQ(add(0, 0), 0);
}
`,
    );

    // Ensure C++ macros and planner/templates are available in the temp repo
    await fs.outputFile(
      path.join(tmp, "cpp", "defs.bzl"),
      await fs.readFile("cpp/defs.bzl", "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "cpp", "wasm_defs.bzl"),
      await fs.readFile("cpp/wasm_defs.bzl", "utf8"),
    );
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/planner/cpp.nix"),
    );
    // Language manifest to enable planner adapter in the temp repo
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix"));
    await fs.writeFile(
      path.join(tmp, "build-tools/tools/nix", "langs.json"),
      JSON.stringify(
        {
          languages: [
            {
              id: "cpp",
              displayName: "C++",
              requiredPaths: [
                "build-tools/tools/nix/planner/cpp.nix",
                "build-tools/tools/nix/templates/cpp.nix",
              ],
              kinds: ["bin", "lib", "test", "addon"],
              templatesDir: "build-tools/tools/scaffolding/templates/cpp",
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    // Local TARGETS for lib + gtest (use nixpkg_deps instead of provider deps in temp)
    const targets = `load("//cpp:defs.bzl", "nix_cpp_library", "nix_cpp_test")

nix_cpp_library(
    name = "lib",
    srcs = [
        "src/core/math.cc",
        "src/cwrapper/addon.cc",
    ],
    headers = [
        "include/addon.h",
        "include/core/math.h",
    ],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)

nix_cpp_test(
    name = "math_core_gtest",
    srcs = ["tests/math_core_gtest.cpp"],
    deps = [":lib"],
    nixpkg_deps = ["pkgs.googletest"],
    labels = ["lang:cpp", "kind:test"],
)
`;
    await fs.outputFile(path.join(libDir, "TARGETS"), targets);

    // Pre-generate a graph.json for the temp repo so cpp_nix_build can find the new target
    await $({ cwd: tmp })`node build-tools/tools/buck/export-graph.ts`;

    // Build and run the test inside the temp repo
    await $`buck2 build --target-platforms prelude//platforms:default //libs/math-core:lib`;
    await $`buck2 test --target-platforms prelude//platforms:default //libs/math-core:math_core_gtest`;
  });
});
