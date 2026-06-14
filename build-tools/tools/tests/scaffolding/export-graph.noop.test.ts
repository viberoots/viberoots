#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";

test("export-graph writes .viberoots/workspace/buck/graph.json and parses", async () => {
  await runInTemp("export-graph", async (tmp, $) => {
    await ensureBuckConfigForTempRepo(tmp, $);
    await $`node build-tools/tools/buck/export-graph.ts --out ${DEFAULT_GRAPH_PATH}`;
    const p = path.join(tmp, DEFAULT_GRAPH_PATH);
    const nodes = await readGraph(p);
    if (!Array.isArray(nodes)) {
      console.error("expected nodes array in graph.json");
      process.exit(2);
    }
  });
});
