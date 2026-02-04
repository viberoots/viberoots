#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp lib scaffold: files render and TARGETS wires gtest deps", async () => {
  await runInTemp("scaf-cpp-lib", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });

    // Ensure language is enabled by presence
    await fs.ensureFile(path.join(tmp, "cpp", "defs.bzl"));
    await fs.copy(path.join(process.cwd(), "cpp", "defs.bzl"), path.join(tmp, "cpp", "defs.bzl"));
    await fs.copy(
      path.join(process.cwd(), "cpp", "wasm_defs.bzl"),
      path.join(tmp, "cpp", "wasm_defs.bzl"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools", "tools", "nix", "templates", "cpp.nix"),
      path.join(tmp, "build-tools", "tools", "nix", "templates", "cpp.nix"),
    );

    // Scaffold
    await $`scaf new cpp lib demo-lib --yes --path=libs/demo-lib`;

    // Expect TARGETS present at the scaffold path
    const targetsPath = path.join(tmp, "libs/demo-lib", "TARGETS");
    assert(await fs.pathExists(targetsPath), "missing libs/demo-lib/TARGETS");

    // Verify TARGETS content references provider-backed gtest targets
    const txt = await fs.readFile(targetsPath, "utf8");
    assert(txt.includes("nix_cpp_test("), "expected nix_cpp_test present");
    assert(
      txt.includes("//third_party/providers:nix_pkgs_googletest"),
      "expected provider gtest dep present",
    );
    assert(
      !txt.includes("//third_party/providers:nix_pkgs_gtest_main"),
      "expected provider gtest_main dep present",
    );
  });
});
