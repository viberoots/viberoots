#!/usr/bin/env zx-wrapper
import * as path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("auto_map generated for scaffolded repo (may be empty)", async () => {
  await runInTemp("scaf-automap-smoke", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`git init`;
    await $`scaf new go lib demo-lib --yes`;
    // Build via Buck; platform is set by runInTemp's .buckconfig
    await $`buck2 build //...`;
    // Ensure glue is generated deterministically in the temp repo
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    const p = path.join(process.cwd(), "third_party", "providers", "auto_map.bzl");
    if (!(await exists(p))) {
      console.error("auto_map.bzl missing after build");
      process.exit(2);
    }
  });
});
