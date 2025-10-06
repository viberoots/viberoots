#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exp-cpp-noncpp-unchanged", async (tmp, $) => {
  const nodes = [{ name: "//apps/web:site", rule_type: "js_binary", labels: ["lang:node"] }];
  const out = path.join(tmp, "tools/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${out} --out ${out}`;

  const after = JSON.parse(await fs.readFile(out, "utf8")) as any[];
  assert.deepEqual(after[0].labels, ["lang:node"]);
});
