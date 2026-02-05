#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node adapter validates malformed lockfile labels even without kind:* (warn mode)", async () => {
  await runInTemp("exp-node-warn-malformed-no-kind", async (tmp, $) => {
    const out = path.join(tmp, "build-tools/tools/buck/.tmp.graph.json");
    await fs.mkdirp(path.dirname(out));
    const nodes = [
      {
        name: "//projects/apps/web:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "lockfile:projects/apps/web/pnpm-lock.yaml"], // missing #importer
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
    if (!txt.includes("[exporter][node]") || !txt.includes("malformed lockfile label")) {
      console.error("expected malformed lockfile label warning", txt);
      process.exit(2);
    }
  });
});
