#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { readCompositeGraph } from "../../lib/graph-view";
import { runInTemp } from "../lib/test-helpers";

test("exporter attaches importer-scoped uv.lock label to python targets", async () => {
  await runInTemp("exp-python-lock", async (tmp, $) => {
    // Create a minimal Python importer with a uv.lock
    const importer = path.join(tmp, "projects/apps/pytool");
    await fs.mkdirp(importer);
    await fs.outputFile(path.join(importer, "uv.lock"), "# lock\n", "utf8");
    await fs.outputFile(path.join(importer, "main.py"), "print('ok')\n", "utf8");

    // Simulated exporter nodes: one python_binary in apps/pytool
    const simNodes = [
      {
        name: "//projects/apps/pytool:tool",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["main.py"],
      },
    ];
    const simPath = path.join(tmp, "nodes.json");
    const outPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fs.mkdirp(path.dirname(outPath));
    await fs.outputFile(simPath, JSON.stringify(simNodes, null, 2), "utf8");

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${simPath} --out ${outPath}`;
    if (res.exitCode !== 0) {
      console.error("exporter failed", String(res.stdout || "") + String(res.stderr || ""));
      process.exit(2);
    }
    const { nodes } = await readCompositeGraph({ graphPath: outPath });
    const byName = new Map(nodes.map((n: any) => [n?.name, n]));
    const n = byName.get("//projects/apps/pytool:tool");
    const labels: string[] = (n?.labels || []) as string[];
    const expected = "lockfile:projects/apps/pytool/uv.lock#projects/apps/pytool";
    if (!labels.includes(expected)) {
      console.error("missing expected lockfile label", expected, labels);
      process.exit(2);
    }
  });
});
