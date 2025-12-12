#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp macros: legacy nix_cxx_attrs fails with an actionable error", async () => {
  await runInTemp("cpp-nixpkg-alias", async (tmp, $) => {
    const appDir = path.join(tmp, "apps/demo");
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int x(){return 42;}\n");
    await fs.outputFile(
      path.join(appDir, "tests", "demo_gtest.cpp"),
      `#include <gtest/gtest.h>
TEST(Demo, T) { EXPECT_EQ(1, 1); }`,
    );
    // Make C++ macros/templates available
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
    // Minimal language manifest enabling cpp
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

    const targets = `load("//cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "demo",
    srcs = ["src/main.cpp"],
)

nix_cpp_test(
    name = "legacy",
    srcs = ["tests/demo_gtest.cpp"],
    nix_cxx_attrs = ["pkgs.googletest"],
)
`;
    await fs.outputFile(path.join(appDir, "TARGETS"), targets, "utf8");

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels "deps(//apps/demo:legacy,0)"`;
    assert.notEqual(probe.exitCode, 0);
    const out = String(probe.stdout || "") + "\n" + String(probe.stderr || "");
    assert.match(out, /nix_cxx_attrs is no longer supported; use nixpkg_deps instead/);
  });
});
