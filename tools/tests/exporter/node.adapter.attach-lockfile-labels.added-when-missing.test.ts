#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node adapter attaches importer lockfile label when missing (env-gated)", async () => {
  await runInTemp("exp-node-attach-missing", async (tmp, $) => {
    const out = path.join(tmp, "tools/buck/.tmp.graph.json");
    await fs.mkdirp(path.dirname(out));
    // Create a lockfile at the derived importer directory: apps/web/pnpm-lock.yaml
    const lock = path.join(tmp, "apps/web/pnpm-lock.yaml");
    await fs.mkdirp(path.dirname(lock));
    await fs.writeFile(
      lock,
      'lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    // Simulate a Node target missing the lockfile label but stamped with kind:*
    const nodes = [
      {
        name: "//apps/web:lib",
        rule_type: "js_library",
        labels: ["lang:node", "kind:lib"],
      },
    ];
    const sim = path.join(tmp, "tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // Enable attach; set validation to warn so the pre-attach validation doesn't fail the run
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, WORKSPACE_ROOT: tmp, EXPORTER_NODE_ATTACH: "1" },
    })`tools/buck/export-graph.ts --simulate ${sim} --out ${out} --validation warn`;
    if (res.exitCode !== 0) {
      console.error("exporter failed:", String(res.stdout || "") + String(res.stderr || ""));
      process.exit(2);
    }

    const parsed = JSON.parse(await fs.readFile(out, "utf8"));
    const nodesOut: Array<{ name: string; labels?: string[] }> = parsed?.nodes || [];
    const n = nodesOut.find((x) => x.name === "//apps/web:lib");
    if (!n) {
      console.error("target not present in exporter output");
      process.exit(2);
    }
    const labs = new Set(n.labels || []);
    const expected = "lockfile:apps/web/pnpm-lock.yaml#apps/web";
    if (!labs.has(expected)) {
      console.error(
        "expected attached lockfile label missing:",
        expected,
        Array.from(labs).join(", "),
      );
      process.exit(2);
    }
  });
});
