#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("gen-auto-map: graph without provider labels produces empty MODULE_PROVIDERS", async () => {
  await runInTemp("auto-map-empty", async (tmp, $) => {
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);
    await $({
      env: graphEnv,
    })`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    const out = await fsp.readFile(
      path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl"),
      "utf8",
    );
    if (!out.includes("MODULE_PROVIDERS = {")) {
      console.error("missing MODULE_PROVIDERS header");
      process.exit(2);
    }
    // Should be no entries
    if (/^    ".*": \[/m.test(out)) {
      console.error("expected no provider entries for graph without provider labels");
      process.exit(2);
    }
  });
});
