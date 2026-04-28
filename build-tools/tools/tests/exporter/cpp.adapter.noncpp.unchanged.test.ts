#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInScratchTemp } from "../lib/test-helpers";

const EXPORT_GRAPH_SCRIPT = path.join(
  process.cwd(),
  "build-tools",
  "tools",
  "buck",
  "export-graph.ts",
);

await runInScratchTemp("exp-cpp-noncpp-unchanged", async (tmp, $) => {
  const nodes = [
    { name: "//projects/apps/web:site", rule_type: "js_binary", labels: ["lang:node"] },
  ];
  const out = path.join(tmp, "build-tools/tools/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`zx-wrapper ${EXPORT_GRAPH_SCRIPT} --simulate ${out} --out ${out}`;

  const after = (await readGraph(out)) as any[];
  assert.deepEqual(after[0].labels, ["lang:node"]);
});
