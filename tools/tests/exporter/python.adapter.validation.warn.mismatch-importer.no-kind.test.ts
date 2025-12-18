#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python adapter validates lockfile importer mismatch even without kind:* (warn mode)", async () => {
  await runInTemp("exp-python-warn-mismatch-no-kind", async (tmp, $) => {
    const out = path.join(tmp, "tools/buck/.tmp.graph.json");
    await fs.mkdirp(path.dirname(out));
    const nodes = [
      {
        name: "//apps/pytool:tool",
        rule_type: "python_binary",
        labels: [
          "lang:python",
          // importer 'libs/foo' does not match directory of lockfile 'apps/pytool'
          "lockfile:apps/pytool/uv.lock#libs/foo",
        ],
        srcs: ["main.py"],
      },
    ];
    const sim = path.join(tmp, "tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`tools/buck/export-graph.ts --simulate ${sim} --out ${out} --validation warn`;
    const txt = String(res.stdout || "") + String(res.stderr || "");
    if (res.exitCode !== 0) {
      console.error("exporter should succeed in warn mode", txt);
      process.exit(2);
    }
    if (!txt.includes("[exporter][python]") || !txt.includes("lockfile importer mismatch")) {
      console.error("expected importer mismatch warning", txt);
      process.exit(2);
    }
  });
});
