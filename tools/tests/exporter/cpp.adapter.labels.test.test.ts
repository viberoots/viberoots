#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exp-cpp-test-labels", async (tmp, $) => {
  const nodes = [{ name: "//apps/demo:demo_test", rule_type: "cxx_test", labels: [] }];
  const out = path.join(tmp, "tools/buck/graph.json");
  await fs.outputFile(out, JSON.stringify(nodes) + "\n");

  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${out} --out ${out}`;

  const after = JSON.parse(await fs.readFile(out, "utf8")) as any[];
  const labs: string[] = after[0].labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:test"));
});
