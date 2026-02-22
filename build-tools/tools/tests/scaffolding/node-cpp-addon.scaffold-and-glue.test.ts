#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

test("node cpp-addon: scaffold and run glue in temp repo", async () => {
  await runInTemp("node-cpp-addon-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    // Ensure git repo so glue helpers that touch git behave deterministically
    await $`git init`;

    // Scaffold the two sibling packages
    await $`scaf new ts cpp-addon demo --yes`;

    // Basic assertions on created files
    const nodePkg = path.join(tmp, "projects", "libs", "demo");
    const nativePkg = path.join(tmp, "projects", "libs", "demo-native");
    for (const p of [
      path.join(nodePkg, "package.json"),
      path.join(nodePkg, "src", "index.ts"),
      path.join(nodePkg, "TARGETS"),
      path.join(nativePkg, "include", "demo.h"),
      path.join(nativePkg, "src", "binding.cc"),
      path.join(nativePkg, "TARGETS"),
    ]) {
      if (!(await exists(p))) {
        throw new Error(`expected file missing: ${p}`);
      }
    }

    // Glue: export graph → sync providers (node) → generate auto_map
    await $`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`.nothrow();
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Guard presence of generated files
    if (!(await exists(path.join(tmp, "build-tools", "tools", "buck", "graph.json")))) {
      throw new Error("graph.json missing after export-graph");
    }
    if (!(await exists(path.join(tmp, "third_party", "providers", "auto_map.bzl")))) {
      throw new Error("auto_map.bzl missing after gen-auto-map");
    }
  });
});
