#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exp-cpp-bin-labels", async (tmp, $) => {
  const nodes = [{ name: "//apps/demo:demo", rule_type: "cxx_binary", labels: [] }];
  const out = path.join(tmp, "build-tools/tools/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${out} --out ${out}`;

  const after = (await readGraph(out)) as any[];
  assert.equal(after.length, 1);
  const labs: string[] = after[0].labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:bin"));
});
