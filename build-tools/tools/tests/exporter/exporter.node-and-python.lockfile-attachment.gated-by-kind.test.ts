#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { readCompositeGraph } from "../../lib/graph-view";
import { importerScopedProviderContractForLang } from "../../lib/lang-contracts";
import { runInTemp } from "../lib/test-helpers";

test("exporter attaches importer lockfile labels only for kind:* (node + python)", async () => {
  await runInTemp("exp-kind-gate-lockfile", async (tmp, $) => {
    assert.equal(
      importerScopedProviderContractForLang("node")?.lockfileLabelAutoAttachRequirement,
      "requires-kind-stamp",
    );
    assert.equal(
      importerScopedProviderContractForLang("python")?.lockfileLabelAutoAttachRequirement,
      "requires-kind-stamp",
    );

    await fs.mkdirp(path.join(tmp, "projects", "apps", "web"));
    await fs.writeFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  projects/apps/web:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "projects", "apps", "pytool"));
    await fs.writeFile(path.join(tmp, "projects", "apps", "pytool", "uv.lock"), "# lock\n", "utf8");

    const simNodes = [
      {
        name: "//projects/apps/web:nokind",
        rule_type: "js_library",
        labels: ["lang:node"],
      },
      {
        name: "//projects/apps/web:kind",
        rule_type: "js_library",
        labels: ["lang:node", "kind:lib"],
      },
      {
        name: "//projects/apps/pytool:nokind",
        rule_type: "python_binary",
        labels: ["lang:python"],
        srcs: ["main.py"],
      },
      {
        name: "//projects/apps/pytool:kind",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["main.py"],
      },
    ];

    const simPath = path.join(tmp, "nodes.json");
    const outPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fs.mkdirp(path.dirname(outPath));
    await fs.writeFile(simPath, JSON.stringify(simNodes, null, 2), "utf8");

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

    {
      const n = byName.get("//projects/apps/web:nokind");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(!labels.some((l) => l.startsWith("lockfile:")));
    }
    {
      const n = byName.get("//projects/apps/web:kind");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(labels.includes("lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"));
    }
    {
      const n = byName.get("//projects/apps/pytool:nokind");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(!labels.some((l) => l.startsWith("lockfile:")));
    }
    {
      const n = byName.get("//projects/apps/pytool:kind");
      const labels: string[] = (n?.labels || []) as string[];
      assert.ok(labels.includes("lockfile:projects/apps/pytool/uv.lock#projects/apps/pytool"));
    }
  });
});
