#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { readCompositeGraph } from "../../lib/graph-view";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { computeImporterLabel, findNearestUvLockForPackage } from "../../lib/importers";

test("python exporter and shared helper agree on nearest uv.lock and importer label", async () => {
  await runInTemp("exp-python-nearest-uv", async (tmp, $) => {
    await fs.mkdirp(path.join(tmp, "projects", "apps", "demo", "nested"));
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "demo", "uv.lock"),
      "# uv lock\n",
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "projects", "libs", "api", "inner"));
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "api", "uv.lock"),
      "# uv lock\n",
      "utf8",
    );

    await fs.outputFile(path.join(tmp, "uv.lock"), "# root uv lock\n", "utf8");

    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);

      const demoLock = await findNearestUvLockForPackage("projects/apps/demo/nested");
      assert.equal(demoLock, "projects/apps/demo/uv.lock");
      assert.equal(computeImporterLabel(demoLock), "projects/apps/demo");

      const apiLock = await findNearestUvLockForPackage("projects/libs/api/inner");
      assert.equal(apiLock, "projects/libs/api/uv.lock");
      assert.equal(computeImporterLabel(apiLock), "projects/libs/api");

      const rootLock = await findNearestUvLockForPackage(".");
      assert.equal(rootLock, "uv.lock");
      assert.equal(computeImporterLabel(rootLock), ".");
    } finally {
      process.chdir(prevCwd);
    }

    const simNodes = [
      {
        name: "//projects/apps/demo/nested:tool",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["tool.py"],
      },
      {
        name: "//projects/libs/api/inner:tool",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["tool.py"],
      },
      {
        name: "//:root_py",
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
    })`build-tools/tools/buck/export-graph.ts --simulate ${simPath} --out ${outPath}`;
    if (res.exitCode !== 0) {
      console.error("exporter failed", String(res.stdout || "") + String(res.stderr || ""));
      process.exit(2);
    }

    const { nodes } = await readCompositeGraph({ graphPath: outPath });
    const byName = new Map(nodes.map((n: any) => [n?.name, n]));

    {
      const n = byName.get("//projects/apps/demo/nested:tool");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(labels.includes("lockfile:projects/apps/demo/uv.lock#projects/apps/demo"));
    }
    {
      const n = byName.get("//projects/libs/api/inner:tool");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(labels.includes("lockfile:projects/libs/api/uv.lock#projects/libs/api"));
    }
    {
      const n = byName.get("//:root_py");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(labels.includes("lockfile:uv.lock#."));
    }
  });
});
