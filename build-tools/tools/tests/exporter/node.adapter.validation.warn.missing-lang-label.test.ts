#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node adapter warns when macro-stamped target lacks lang:node (warn mode)", async () => {
  await runInTemp("exp-node-warn-missing-lang", async (tmp, $) => {
    const out = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fs.mkdirp(path.dirname(out));
    // Macro-stamped pattern: has importer-scoped lockfile and kind label,
    // but is missing the lang:node label.
    const nodes = [
      {
        name: "//projects/apps/web:bundle",
        rule_type: "genrule",
        labels: ["kind:bundle", "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
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
    if (
      !txt.includes("validation warnings") ||
      !txt.includes("[exporter][node]") ||
      !txt.includes("lang:node")
    ) {
      console.error("expected node adapter missing lang:node advisory in aggregated output", txt);
      process.exit(2);
    }
  });
});
