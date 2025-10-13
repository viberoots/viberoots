#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp openssl include via nixpkg providers only (no local shim)", async () => {
  await runInTemp("cpp-nixpkg-include-openssl", async (tmp, $) => {
    const appDir = path.join(tmp, "apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n");

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
    // Provide empty nix_attr_map for macro load; provider sync will overwrite when run
    await fs.mkdirp(path.join(tmp, "third_party/providers"));
    await fs.outputFile(
      path.join(tmp, "third_party/providers/nix_attr_map.bzl"),
      "NIX_ATTR_MAP = {}\n",
      "utf8",
    );

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

    await fs.outputFile(
      path.join(appDir, "tests", "demo_openssl_gtest.cpp"),
      `#include <openssl/ssl.h>\n#include <gtest/gtest.h>\n\nTEST(OpenSSL, CanInclude) { SUCCEED(); }\n`,
    );

    const targets = `load("//cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "demo_openssl_gtest",
    srcs = ["tests/demo_openssl_gtest.cpp"],
    deps = [
        "//third_party/providers:nix_pkgs_pkgs_googletest",
        "//third_party/providers:nix_pkgs_pkgs_openssl",
    ],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets);

    await $`buck2 test --target-platforms prelude//platforms:default //apps/demo:demo_openssl_gtest`;
  });
});
