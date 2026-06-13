#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exp-cpp-preserve", async (tmp, $) => {
  const nodes = [
    {
      name: "//projects/apps/demo:demo",
      rule_type: "cxx_binary",
      labels: ["custom:x", "lang:cpp", "kind:bin"],
    },
  ];
  const out = path.join(tmp, ".viberoots/workspace/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${out} --out ${out}`;

  const after = (await readGraph(out)) as any[];
  const labs: string[] = after[0].labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:bin"));
  assert.ok(labs.includes("custom:x"));
});
