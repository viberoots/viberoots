#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp zlib include via nixpkg providers only (no local shim)", async () => {
  await runInTemp("cpp-nixpkg-include-zlib", async (tmp, $) => {
    const appDir = path.join(tmp, "apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n");

    // Copy macros and Nix artifacts required by the external runner
    await fs.outputFile(
      path.join(tmp, "cpp", "defs.bzl"),
      await fs.readFile("cpp/defs.bzl", "utf8"),
    );
    await fs.mkdirp(path.join(tmp, "tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "tools/nix/templates/cpp.nix"),
      path.join(tmp, "tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "tools/nix/planner/cpp.nix"),
      path.join(tmp, "tools/nix/planner/cpp.nix"),
    );

    // Minimal manifest enabling cpp
    const langs = {
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["tools/nix/planner/cpp.nix", "tools/nix/templates/cpp.nix"],
          kinds: ["bin", "lib", "test"],
          templatesDir: "tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
    );

    // Add a trivial gtest that includes a zlib header to validate include paths from nixpkgs
    await fs.outputFile(
      path.join(appDir, "tests", "demo_zlib_gtest.cpp"),
      `#include <zlib.h>\n#include <gtest/gtest.h>\n\nTEST(ZlibSmoke, CanInclude) { SUCCEED(); }\n`,
    );

    const targets = `load("//cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_zlib_gtest",
    srcs = ["tests/demo_zlib_gtest.cpp"],
    deps = [
        "//third_party/providers:nix_pkgs_gtest_main",
        "//third_party/providers:nix_pkgs_gtest",
        "//third_party/providers:nix_pkgs_zlib",
    ],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets);

    // Build and run the test; explicit platform to bind toolchains
    await $`buck2 test --target-platforms prelude//platforms:default //apps/demo:demo_zlib_gtest`;
  });
});
