#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node adapter warns when lockfile label is missing (warn mode)", async () => {
  await runInTemp("exp-node-warn-missing", async (tmp, $) => {
    const out = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(out));
    // The temp workspace is a copy of this repo and includes a root pnpm-lock.yaml.
    // Remove it so "nearest lockfile" discovery returns null and the adapter emits a warning.
    await fs.remove(path.join(tmp, "pnpm-lock.yaml"));
    await fs.remove(path.join(tmp, "apps", "web", "pnpm-lock.yaml"));
    const nodes = [
      {
        name: "//projects/apps/web:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle"],
      },
    ];
    const sim = path.join(tmp, "build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${out} --validation warn`;
    const txt = String(res.stdout || "") + String(res.stderr || "");
    if (res.exitCode !== 0) {
      console.error("exporter should succeed in warn mode", txt);
      process.exit(2);
    }
    if (!txt.includes("validation warnings") || !txt.includes("[exporter][node]")) {
      console.error("expected node adapter warning in aggregated output", txt);
      process.exit(2);
    }
  });
});
