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
    await $`scaf new node go-addon demo --yes`;

    // Basic assertions on created files
    const nodePkg = path.join(tmp, "libs", "demo");
    const goPkg = path.join(tmp, "libs", "demo-go");
    const nativePkg = path.join(tmp, "libs", "demo-native");
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
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers-node.ts`.nothrow();
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Guard presence of generated files
    if (!(await exists(path.join(tmp, "tools", "buck", "graph.json")))) {
      throw new Error("graph.json missing after export-graph");
    }
    if (!(await exists(path.join(tmp, "third_party", "providers", "auto_map.bzl")))) {
      throw new Error("auto_map.bzl missing after gen-auto-map");
    }
  });
});
