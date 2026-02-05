#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("glue/generator emits node-lock-index.json deterministically", async () => {
  await runInTemp("exp-node-sidecar", async (tmp, $) => {
    const sidecar = path.join(tmp, "build-tools/tools/buck/node-lock-index.json");
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
    const sim = path.join(tmp, "build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // First run
    await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${sim}`;
    // Generate sidecar via glue/generator
    await $({ cwd: tmp })`node build-tools/tools/buck/gen-provider-index.ts`;
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
    await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${sim}`;
    await $({ cwd: tmp })`node build-tools/tools/buck/gen-provider-index.ts`;
    const b = await fs.readFile(sidecar, "utf8");
    assert.equal(a, b, "sidecar should be deterministic across runs");
  });
});
