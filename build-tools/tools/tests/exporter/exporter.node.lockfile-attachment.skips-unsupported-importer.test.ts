#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { readCompositeGraph } from "../../lib/graph-view";
import { runInTemp } from "../lib/test-helpers";

test("node exporter does not auto-attach lockfile labels for unsupported importer roots", async () => {
  await runInTemp("exp-node-unsupported-importer-autoattach", async (tmp, $) => {
    await fs.mkdirp(path.join(tmp, "services", "api"));
    await fs.outputFile(
      path.join(tmp, "services", "api", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  services/api:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "projects", "apps", "foo", "bar"));
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "foo", "bar", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  projects/apps/foo/bar:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    const simNodes = [
      {
        name: "//services/api:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle"],
      },
      {
        name: "//projects/apps/foo/bar:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle"],
      },
    ];

    const simPath = path.join(tmp, "nodes.json");
    const outPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fs.mkdirp(path.dirname(outPath));
    await fs.writeFile(simPath, JSON.stringify(simNodes, null, 2), "utf8");

    {
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
      })`build-tools/tools/buck/export-graph.ts --simulate ${simPath} --out ${outPath} --validation warn`;
      const txt = String(res.stdout || "") + String(res.stderr || "");
      if (res.exitCode !== 0) {
        console.error("exporter should succeed in warn mode", txt);
        process.exit(2);
      }
      if (!txt.includes("validation warnings") || !txt.includes("unsupported importer root")) {
        console.error("expected a deterministic unsupported-importer warning", txt);
        process.exit(2);
      }

      const { nodes } = await readCompositeGraph({ graphPath: outPath });
      const byName = new Map(nodes.map((n: any) => [n?.name, n]));
      for (const name of ["//services/api:bundle", "//projects/apps/foo/bar:bundle"]) {
        const n = byName.get(name);
        const labels: string[] = (n?.labels || []) as string[];
        assert.ok(!labels.some((l) => l.startsWith("lockfile:")));
      }
    }

    {
      let out = "";
      let code = 0;
      try {
        const res = await $({
          cwd: tmp,
          stdio: "pipe",
        })`build-tools/tools/buck/export-graph.ts --simulate ${simPath} --out ${outPath}`;
        out = String(res.stdout || "") + String(res.stderr || "");
        code = res.exitCode || 0;
      } catch (e: any) {
        out = String(e?.stdout || "") + String(e?.stderr || "");
        code = typeof e?.exitCode === "number" ? e.exitCode : 1;
      }
      if (code === 0) {
        console.error("expected exporter to fail in error mode", out);
        process.exit(2);
      }
      if (!out.includes("validation errors") || !out.includes("unsupported importer root")) {
        console.error("expected aggregated error for unsupported-importer auto-attach", out);
        process.exit(2);
      }
    }
  });
});
