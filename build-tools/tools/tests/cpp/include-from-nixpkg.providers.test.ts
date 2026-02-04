#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp gtest include via nixpkg_deps at call site", async () => {
  await runInTemp("cpp-nixpkg-include", async (tmp, $) => {
    // Write a minimal app with a single gtest
    const appDir = path.join(tmp, "apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n");
    // Ensure C++ macros are available in the temp repo
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "defs.bzl"),
      await fs.readFile("build-tools/cpp/defs.bzl", "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "build-tools", "cpp", "wasm_defs.bzl"),
      await fs.readFile("build-tools/cpp/wasm_defs.bzl", "utf8"),
    );
    // Provide the Nix template used by the external runner
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"),
    );
    // Provide the cpp planner plugin so graph-generator sees C++ targets
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/planner/cpp.nix"),
    );
    // Enable cpp via manifest so planner picks it deterministically
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix"));
    const langs = {
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "build-tools/tools/nix/planner/cpp.nix",
            "build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["bin", "lib", "test"],
          templatesDir: "build-tools/tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.writeFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(appDir, "tests", "demo_gtest.cpp"),
      `#include <gtest/gtest.h>\n\nTEST(Demo, Smoke) { EXPECT_EQ(1,1); }\n`,
    );
    const targets = `load("//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_gtest",
    srcs = ["tests/demo_gtest.cpp"],
    nixpkg_deps = ["pkgs.googletest"],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets);

    // Ensure local shim is not referenced anywhere (sanity)
    const rootTargets = await fs.readFile(path.join(tmp, "TARGETS"), "utf8").catch(() => "");
    assert.ok(!rootTargets.includes("third_party/cpp:gtest"));

    // Build and run the test; explicit platform to bind toolchains
    await $`buck2 test --target-platforms prelude//platforms:default //apps/demo:demo_gtest`;
  });
});
