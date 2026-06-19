#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node adapter attaches importer lockfile label when missing", async () => {
  await runInTemp("exp-node-attach-missing", async (tmp, $) => {
    const out = path.join(tmp, "viberoots/build-tools/tools/buck/.tmp.graph.json");
    await fs.mkdirp(path.dirname(out));
    // Create a lockfile at the derived importer directory: projects/apps/web/pnpm-lock.yaml
    const lock = path.join(tmp, "projects/apps/web/pnpm-lock.yaml");
    await fs.mkdirp(path.dirname(lock));
    await fs.writeFile(
      lock,
      'lockfileVersion: "9.0"\nimporters:\n  projects/apps/web:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    // Simulate a Node target missing the lockfile label but stamped with kind:*
    const nodes = [
      {
        name: "//projects/apps/web:lib",
        rule_type: "js_library",
        labels: ["lang:node", "kind:lib"],
      },
    ];
    const sim = path.join(tmp, "viberoots/build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    // Attachment is deterministic when a pnpm lockfile is discoverable and a lockfile label is missing.
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, WORKSPACE_ROOT: tmp },
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${out}`;
    if (res.exitCode !== 0) {
      console.error("exporter failed:", String(res.stdout || "") + String(res.stderr || ""));
      process.exit(2);
    }

    const parsed = JSON.parse(await fs.readFile(out, "utf8"));
    const nodesOut: Array<{ name: string; labels?: string[] }> = parsed?.nodes || [];
    const n = nodesOut.find((x) => x.name === "//projects/apps/web:lib");
    if (!n) {
      console.error("target not present in exporter output");
      process.exit(2);
    }
    const labs = new Set(n.labels || []);
    const expected = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web";
    if (!labs.has(expected)) {
      console.error(
        "expected attached lockfile label missing:",
        expected,
        Array.from(labs).join(", "),
      );
      process.exit(2);
    }
    const lockLabels = (n.labels || []).filter((l) => String(l).startsWith("lockfile:"));
    if (lockLabels.length !== 1) {
      console.error("expected exactly one lockfile label, got:", lockLabels.join(", "));
      process.exit(2);
    }
    const sorted = [...(n.labels || [])].slice().sort();
    if (JSON.stringify(sorted) !== JSON.stringify(n.labels || [])) {
      console.error("expected labels to be stable-sorted:", JSON.stringify(n.labels || []));
      process.exit(2);
    }
  });
});
