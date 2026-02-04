#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exp-cpp-noncpp-unchanged", async (tmp, $) => {
  const nodes = [{ name: "//apps/web:site", rule_type: "js_binary", labels: ["lang:node"] }];
  const out = path.join(tmp, "build-tools/tools/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${out} --out ${out}`;

  const after = (await readGraph(out)) as any[];
  assert.deepEqual(after[0].labels, ["lang:node"]);
});
