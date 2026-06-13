#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macro: providers are auto-wired from auto_map", async () => {
  await runInTemp("node-macro-providers-wiring", async (tmp, $) => {
    // Synthesize a minimal graph.json with a Node target and lockfile label
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    const nodes = [
      {
        name: "//projects/apps/example:smoke_test",
        rule_type: "genrule",
        labels: [
          "lockfile:projects/apps/example/pnpm-lock.yaml#projects/apps/example",
          "lang:node",
          "kind:test",
        ],
      },
    ];
    await fs.writeJSON(path.join(graphDir, "graph.json"), nodes, { spaces: 2 });

    // Run auto-map generation over the synthesized graph
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    const autoMapPath = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    const content = await fs.readFile(autoMapPath, "utf8");
    const key = '"//projects/apps/example:smoke_test"';
    const start = content.indexOf(key);
    assert.ok(start >= 0, "auto_map contains target key for smoke_test");
    const slice = content.slice(start, Math.min(content.length, start + 500));
    assert.match(
      slice,
      /lf_[a-f0-9]{12}_[a-z0-9_]+/i,
      "expected importer-scoped provider in mapping",
    );
  });
});
