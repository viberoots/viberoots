#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter emits node-lock-index with sorted keys and no rewrite on second run", async () => {
  await runInTemp("exp-node-sidecar-sorted", async (tmp, $) => {
    const out = path.join(tmp, ".tmp", "graph.json");
    const sidecar = path.join(tmp, "tools/buck/node-lock-index.json");
    await fs.mkdirp(path.dirname(out));
    await fs.mkdirp(path.dirname(sidecar));

    // Simulate two Node targets in reverse order to ensure exporter sorts output keys
    const nodes = [
      {
        name: "//zz/app:bin",
        rule_type: "js_binary",
        labels: ["lang:node", "lockfile:apps/zz/pnpm-lock.yaml#apps/zz"],
      },
      {
        name: "//aa/web:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "lockfile:apps/aa/pnpm-lock.yaml#apps/aa"],
      },
    ];
    const sim = path.join(tmp, "tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // First run
    await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${sim} --out ${out}`;
    assert.ok(await fs.pathExists(out), "graph output should exist");
    assert.ok(await fs.pathExists(sidecar), "node-lock-index.json should exist");

    // Validate sorted keys in sidecar index
    const aTxt = await fs.readFile(sidecar, "utf8");
    const aJson = JSON.parse(aTxt);
    const idxA = aJson && typeof aJson === "object" && aJson.index ? aJson.index : aJson;
    const keys = Object.keys(idxA);
    const sorted = [...keys].sort((x, y) => x.localeCompare(y));
    assert.deepEqual(keys, sorted, "sidecar index keys should be sorted");

    // Capture mtime, wait a tick to ensure detectable change if rewritten
    const statBefore = await fs.stat(sidecar);
    await new Promise((r) => setTimeout(r, 15));

    // Second run must be a no-op write (mtime unchanged)
    await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${sim} --out ${out}`;
    const statAfter = await fs.stat(sidecar);
    assert.equal(
      Number(statAfter.mtimeMs),
      Number(statBefore.mtimeMs),
      "sidecar file mtime should be unchanged on identical second run",
    );
  });
});
