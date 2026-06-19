#!/usr/bin/env zx-wrapper
import * as path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("auto_map generated for scaffolded repo (may be empty)", async () => {
  await runInTemp("scaf-automap-smoke", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`git init`;
    await $`scaf new go lib demo-lib --yes`;
    // Avoid full-repo build; just scaffold and generate glue
    // Ensure glue is generated deterministically in the temp repo
    await $`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    const p = path.join(process.cwd(), ".viberoots", "workspace", "providers", "auto_map.bzl");
    if (!(await exists(p))) {
      console.error("auto_map.bzl missing after build");
      process.exit(2);
    }
  });
});
