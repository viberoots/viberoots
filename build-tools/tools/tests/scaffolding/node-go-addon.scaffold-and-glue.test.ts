#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

test("node go-addon: scaffold and run glue in temp repo", async () => {
  await runInTemp("node-go-addon-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    // Ensure git repo so glue helpers that touch git behave deterministically
    await $`git init`;

    // Scaffold the three sibling packages
    await $`scaf new ts go-addon demo --yes --skip-lockfile-gen`;

    // Basic assertions on created files
    const nodePkg = path.join(tmp, "projects", "libs", "demo");
    const goPkg = path.join(tmp, "projects", "libs", "demo-go");
    const nativePkg = path.join(tmp, "projects", "libs", "demo-native");
    for (const p of [
      path.join(nodePkg, "package.json"),
      path.join(nodePkg, "src", "index.ts"),
      path.join(nodePkg, "TARGETS"),
      path.join(goPkg, "pkg", "addon", "addon.go"),
      path.join(goPkg, "TARGETS"),
      path.join(nativePkg, "src", "binding.c"),
      path.join(nativePkg, "TARGETS"),
    ]) {
      if (!(await exists(p))) {
        throw new Error(`expected file missing: ${p}`);
      }
    }

    // Glue: export graph → sync providers (node) → generate auto_map
    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`.nothrow();
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    // Guard presence of generated files
    if (!(await exists(path.join(tmp, ".viberoots", "workspace", "buck", "graph.json")))) {
      throw new Error("graph.json missing after export-graph");
    }
    if (!(await exists(path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl")))) {
      throw new Error("auto_map.bzl missing after gen-auto-map");
    }
  });
});
