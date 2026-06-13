#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("contract(go): auto_map presence (providers not required for Go)", async () => {
  await runInTemp("go-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    // current-contract: Go providers are not required; only ensure auto_map can be generated

    // Export a tiny graph and generate auto_map
    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    // Presence assertion
    await $`bash --noprofile --norc -c 'test -s .viberoots/workspace/providers/auto_map.bzl'`;
  });
});
