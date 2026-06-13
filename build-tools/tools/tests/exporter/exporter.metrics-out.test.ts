#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeGoModule } from "../lib/fixtures/go";
import { runInTemp } from "../lib/test-helpers";

test("exporter writes metrics when --metrics-out is provided", async () => {
  await runInTemp("exporter-metrics", async (tmp, $) => {
    const out = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const metrics = path.join(tmp, "build-tools/tools/buck/export-metrics.json");

    await fs.mkdirp(path.dirname(out));
    await fs.mkdirp(path.dirname(metrics));

    // Use fixture writer to create a tiny module and derive nodes
    const modDir = await writeGoModule(tmp, { modulePath: "m" });
    void modDir;
    const nodes = [
      { name: "//m:bin", rule_type: "go_binary", labels: ["lang:go"] },
      { name: "//m:pkg", rule_type: "go_library", labels: ["lang:go"] },
    ];
    const sim = path.join(tmp, "build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // Run in simulate mode so it doesn’t query buck
    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${out} --metrics-out ${metrics}`;

    assert.ok(await fs.pathExists(out), "graph.json should exist");
    assert.ok(await fs.pathExists(metrics), "metrics file should exist");
    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    assert.equal(typeof m.totalBatches, "number");
    assert.ok(Array.isArray(m.tupleKeys));
  });
});
