#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python adapter errors in CI when .py sources lack rule_type and lang:python", async () => {
  await runInTemp("exp-python-ci-error-missing-lang", async (tmp, $) => {
    const out = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.mkdirp(path.dirname(out));
    const nodes = [
      {
        name: "//projects/apps/pytool:bin",
        labels: [],
        srcs: ["apps/pytool/main.py"],
      },
    ];
    const sim = path.join(tmp, "viberoots/build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    let txt = "";
    let code = 0;
    try {
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        env: { ...process.env, CI: "true" },
      })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${out} --validation warn`;
      txt = String(res.stdout || "") + String(res.stderr || "");
      code = res.exitCode || 0;
    } catch (e: any) {
      txt = String(e?.stdout || "") + String(e?.stderr || "");
      code = typeof e?.exitCode === "number" ? e.exitCode : 1;
    }
    if (code === 0) {
      console.error("expected exporter to fail in CI despite warn mode", txt);
      process.exit(2);
    }
    if (!txt.includes("validation errors") || !txt.includes("[exporter][python]")) {
      console.error("expected aggregated errors including python adapter message", txt);
      process.exit(2);
    }
  });
});
