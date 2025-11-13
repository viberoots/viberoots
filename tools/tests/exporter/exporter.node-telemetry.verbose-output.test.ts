#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter verbose timing logs for node adapter and sidecar", async () => {
  await runInTemp("exp-node-telemetry", async (tmp, $) => {
    const out = path.join(tmp, "graph.json");
    await fs.mkdirp(path.dirname(out));
    const nodes = [
      {
        name: "//apps/web:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle", "lockfile:apps/web/pnpm-lock.yaml#apps/web"],
      },
    ];
    const sim = path.join(tmp, "tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      env: { ...process.env, EXPORTER_VERBOSE: "1" },
    })`tools/buck/export-graph.ts --simulate ${sim} --out ${out}`;
    const txt = String(res.stdout || "") + String(res.stderr || "");
    if (res.exitCode !== 0) {
      console.error("exporter should succeed in verbose mode", txt);
      process.exit(2);
    }
    const hasValidate = /\[exporter\]\[timing\] node\.validate: \d+ms/.test(txt);
    if (!hasValidate) {
      console.error("expected verbose timing line for node.validate", txt);
      process.exit(2);
    }
  });
});
