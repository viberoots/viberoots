#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("cpp openssl include via nixpkg_deps at call site", async () => {
  await runInTemp("cpp-nixpkg-include-openssl", async (tmp, $) => {
    const appDir = path.join(tmp, "projects/apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n");

    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"),
      await fs.readFile(viberootsSourcePath("viberoots/build-tools/cpp/defs.bzl"), "utf8"),
    );
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "cpp", "wasm_defs.bzl"),
      await fs.readFile(viberootsSourcePath("viberoots/build-tools/cpp/wasm_defs.bzl"), "utf8"),
    );
    await fs.mkdirp(path.join(tmp, "viberoots/build-tools/tools/nix/templates"));
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/nix/templates/cpp.nix",
      path.join(tmp, "viberoots/build-tools/tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "viberoots/build-tools/tools/nix/planner"));
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/nix/planner/cpp.nix",
      path.join(tmp, "viberoots/build-tools/tools/nix/planner/cpp.nix"),
    );
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
    );

    await fs.outputFile(
      path.join(appDir, "tests", "demo_openssl_gtest.cpp"),
      `#include <openssl/ssl.h>\n#include <gtest/gtest.h>\n\nTEST(OpenSSL, CanInclude) { SUCCEED(); }\n`,
    );

    const targets = `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_openssl_gtest",
    srcs = ["tests/demo_openssl_gtest.cpp"],
    nixpkg_deps = ["pkgs.googletest", "pkgs.openssl"],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets);

    await $`buck2 test --target-platforms prelude//platforms:default //projects/apps/demo:demo_openssl_gtest`;
  });
});
