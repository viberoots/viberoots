#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH, DEFAULT_NODE_LOCK_INDEX_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("glue/generator emits node-lock-index.json deterministically", async () => {
  await runInTemp("exp-node-sidecar", async (tmp, $) => {
    const sidecar = path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH);
    await fs.mkdirp(path.dirname(sidecar));
    const nodes = [
      {
        name: "//projects/apps/web:bundle",
        rule_type: "js_binary",
        labels: [
          "lang:node",
          "kind:bundle",
          "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
        ],
      },
      {
        name: "//projects/libs/ui:lib",
        rule_type: "go_library",
        labels: ["lang:go"],
      },
    ];
    const sim = path.join(tmp, path.dirname(DEFAULT_GRAPH_PATH), "simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // First run
    await $({ cwd: tmp })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim}`;
    // Generate sidecar via glue/generator
    await $({ cwd: tmp })`node viberoots/build-tools/tools/buck/gen-provider-index.ts`;
    assert.ok(await fs.pathExists(sidecar), "node-lock-index.json should exist");
    const a = await fs.readFile(sidecar, "utf8");
    const parsed = JSON.parse(a);
    const idxA = parsed && typeof parsed === "object" && parsed.index ? parsed.index : parsed;
    assert.equal(
      idxA["//projects/apps/web:bundle"],
      "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
      "sidecar should map target to importer-scoped lockfile label",
    );

    // Second run must be a no-op w.r.t. sidecar content
    await $({ cwd: tmp })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim}`;
    await $({ cwd: tmp })`node viberoots/build-tools/tools/buck/gen-provider-index.ts`;
    const b = await fs.readFile(sidecar, "utf8");
    assert.equal(a, b, "sidecar should be deterministic across runs");
  });
});

test("glue/generator emits an empty node-lock-index for an empty graph", async () => {
  await runInTemp("exp-node-sidecar-empty", async (tmp, $) => {
    const sidecar = path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH);
    const graph = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fs.outputFile(
      sidecar,
      JSON.stringify({ version: 1, index: { "//stale:target": "lockfile:stale" } }) + "\n",
    );
    await fs.outputFile(
      graph,
      JSON.stringify({ $schema: "x", version: 1, nodes: [] }, null, 2) + "\n",
    );

    await $({ cwd: tmp })`node viberoots/build-tools/tools/buck/gen-provider-index.ts`;

    assert.deepEqual(JSON.parse(await fs.readFile(sidecar, "utf8")), {
      $schema: "https://example.com/schemas/node-lock-index.schema.json",
      version: 1,
      index: {},
    });

    const firstStat = await fs.stat(sidecar);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await $({ cwd: tmp })`node viberoots/build-tools/tools/buck/gen-provider-index.ts`;
    assert.equal((await fs.stat(sidecar)).mtimeMs, firstStat.mtimeMs);
  });
});
