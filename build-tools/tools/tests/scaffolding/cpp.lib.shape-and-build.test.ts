#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "./lib/viberoots-tools";

async function activeBuildToolsRoot(): Promise<string> {
  const direct = path.join(process.cwd(), "viberoots", "build-tools");
  if (await fs.pathExists(direct)) return direct;
  return viberootsTool("build-tools");
}

test("cpp lib scaffold: files render and TARGETS wires gtest deps", async () => {
  await runInTemp("scaf-cpp-lib", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    const buildTools = await activeBuildToolsRoot();

    // Ensure language is enabled by presence
    await fs.ensureFile(path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"));
    await fs.copy(
      path.join(buildTools, "cpp", "defs.bzl"),
      path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"),
    );
    await fs.copy(
      path.join(buildTools, "cpp", "wasm_defs.bzl"),
      path.join(tmp, "viberoots", "build-tools", "cpp", "wasm_defs.bzl"),
    );
    await fs.copy(
      path.join(buildTools, "tools", "nix", "templates", "cpp.nix"),
      path.join(tmp, "viberoots", "build-tools", "tools", "nix", "templates", "cpp.nix"),
    );
    await fs.copy(
      path.join(buildTools, "tools", "scaffolding", "templates", "cpp", "lib"),
      path.join(tmp, "build-tools", "tools", "scaffolding", "templates", "cpp", "lib"),
    );

    // Scaffold
    await $`${path.join(buildTools, "tools", "bin", "scaf")} new cpp lib demo-lib --yes --path=projects/libs/demo-lib`;

    // Expect TARGETS present at the scaffold path
    const targetsPath = path.join(tmp, "projects/libs/demo-lib", "TARGETS");
    assert(await fs.pathExists(targetsPath), "missing projects/libs/demo-lib/TARGETS");

    // Verify TARGETS content references provider-backed gtest targets
    const txt = await fs.readFile(targetsPath, "utf8");
    assert(txt.includes("nix_cpp_test("), "expected nix_cpp_test present");
    assert(
      txt.includes("workspace_providers//:nix_pkgs_googletest"),
      "expected provider gtest dep present",
    );
    assert(
      !txt.includes("workspace_providers//:nix_pkgs_gtest_main"),
      "expected provider gtest_main dep present",
    );
  });
});
