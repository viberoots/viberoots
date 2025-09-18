#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter writes metrics when --metrics-out is provided", async () => {
  await runInTemp("exporter-metrics", async (tmp, $) => {
    const out = path.join(tmp, "tools/buck/graph.json");
    const metrics = path.join(tmp, "tools/buck/export-metrics.json");

    await fs.mkdirp(path.dirname(out));
    await fs.mkdirp(path.dirname(metrics));

    // Simulate a minimal graph to avoid requiring buck2 for this unit test
    const nodes = [
      { name: "//app:bin", rule_type: "go_binary", labels: ["lang:go"] },
      { name: "//lib:pkg", rule_type: "go_library", labels: ["lang:go"] },
    ];
    const sim = path.join(tmp, "tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // Run in simulate mode so it doesn’t query buck
    await $({
      cwd: tmp,
    })`node tools/buck/export-graph.ts --simulate ${sim} --out ${out} --metrics-out ${metrics}`;

    assert.ok(await fs.pathExists(out), "graph.json should exist");
    assert.ok(await fs.pathExists(metrics), "metrics file should exist");
    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    assert.equal(typeof m.totalBatches, "number");
    assert.ok(Array.isArray(m.tupleKeys));
  });
});
