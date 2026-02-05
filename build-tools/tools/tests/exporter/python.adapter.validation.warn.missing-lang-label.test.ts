#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python adapter warns when .py sources lack rule_type and lang:python (warn mode)", async () => {
  await runInTemp("exp-python-warn-missing-lang", async (tmp, $) => {
    const out = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fs.mkdirp(path.dirname(out));
    // Simulate a target with .py sources but missing both python_* rule_type and lang:python label
    const nodes = [
      {
        name: "//projects/apps/pytool:bin",
        // rule_type intentionally omitted
        labels: [],
        srcs: ["apps/pytool/main.py"],
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
      !txt.includes("[exporter][python]") ||
      !txt.includes("lang:python")
    ) {
      console.error(
        "expected python adapter missing lang:python advisory in aggregated output",
        txt,
      );
      process.exit(2);
    }
  });
});
