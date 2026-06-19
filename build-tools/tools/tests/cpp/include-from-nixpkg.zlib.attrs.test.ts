#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp zlib include via nixpkg_deps at call site (no providers)", async () => {
  await runInTemp("cpp-nixattrs-zlib-include", async (tmp, $) => {
    const appDir = path.join(tmp, "projects/apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n");
    // Copy macros and Nix artifacts required by the external runner
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"),
      await fs.readFile("viberoots/build-tools/cpp/defs.bzl", "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "cpp", "wasm_defs.bzl"),
      await fs.readFile("viberoots/build-tools/cpp/wasm_defs.bzl", "utf8"),
    );
    await fs.mkdirp(path.join(tmp, "viberoots/build-tools/tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "viberoots/build-tools/tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "viberoots/build-tools/tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "viberoots/build-tools/tools/nix/planner/cpp.nix"),
    );
    // Minimal manifest enabling cpp
    const langs = {
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "viberoots/build-tools/tools/nix/planner/cpp.nix",
            "viberoots/build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["bin", "lib", "test"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
      "utf8",
    );
    // Test with zlib include and gtest harness
    await fs.outputFile(
      path.join(appDir, "tests", "demo_zlib_gtest.cpp"),
      `#include <zlib.h>\n#include <gtest/gtest.h>\n\nTEST(ZlibSmoke, CanInclude) { SUCCEED(); }\n`,
    );
    const targets = `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_zlib_gtest",
    srcs = ["tests/demo_zlib_gtest.cpp"],
    nixpkg_deps = ["pkgs.zlib", "pkgs.googletest"],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets);
    // Build and run the test; explicit platform to bind toolchains
    await $`buck2 test --target-platforms prelude//platforms:default //projects/apps/demo:demo_zlib_gtest`;
  });
});
