#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("contract(go): auto_map presence (providers not required for Go)", async () => {
  await runInTemp("go-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    // PR6: Go providers are not required; only ensure auto_map can be generated

    // Export a tiny graph and generate auto_map
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Presence assertion
    await $`bash -lc 'test -s third_party/providers/auto_map.bzl'`;
  });
});
