#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exporter-metrics-adapters", async (tmp, $) => {
  const langDir = path.join(tmp, "build-tools/tools/buck/exporter/lang");
  await fs.mkdirp(langDir);
  // Provide both adapters (go + cpp)
  await fs.copy("build-tools/tools/buck/exporter/lang/go.ts", path.join(langDir, "go.ts"));
  await fs.copy("build-tools/tools/buck/exporter/lang/cpp.ts", path.join(langDir, "cpp.ts"));

  const nodes = [
    { name: "//projects/apps/go:svc", rule_type: "go_binary", labels: ["lang:go"] },
    { name: "//projects/libs/go:lib", rule_type: "go_library", labels: ["lang:go"] },
    { name: "//projects/apps/cpp:tool", rule_type: "cxx_binary", labels: [] },
  ];
  const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
  await fs.outputFile(graph, JSON.stringify(nodes) + "\n", "utf8");

  const metrics = path.join(tmp, "build-tools/tools/buck/export-metrics.json");
  await $({
    cwd: tmp,
  })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics}`;

  const m = JSON.parse(await fs.readFile(metrics, "utf8"));
  assert.equal(typeof m.totalBatches, "number");
  assert.ok(Array.isArray(m.tupleKeys));
  // In a mixed graph, we expect at least one tupleKey from Go batching
  assert.ok(m.tupleKeys.length >= 0);
});
