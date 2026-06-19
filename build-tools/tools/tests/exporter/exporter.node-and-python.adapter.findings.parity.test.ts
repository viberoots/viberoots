#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function mustInclude(haystack: string, needle: string) {
  if (!haystack.includes(needle)) {
    console.error(`expected output to include: ${needle}\n\n--- output ---\n${haystack}`);
    process.exit(2);
  }
}

test("node and python adapters emit consistent finding styles for shared importer-scoped violations", async () => {
  await runInTemp("exp-node-python-finding-style-parity", async (tmp, $) => {
    await fs.mkdirp(path.join(tmp, "apps", "web"));
    await fs.outputFile(
      path.join(tmp, "apps", "web", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "apps", "pytool"));
    await fs.outputFile(path.join(tmp, "apps", "pytool", "uv.lock"), "# uv lock\n", "utf8");

    await fs.mkdirp(path.join(tmp, "services", "api"));
    await fs.outputFile(
      path.join(tmp, "services", "api", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  services/api:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );
    await fs.outputFile(path.join(tmp, "services", "api", "uv.lock"), "# uv lock\n", "utf8");

    const nodes = [
      // Missing kind:* when macro-stamped (lockfile label present)
      {
        name: "//projects/apps/web:missing_kind",
        rule_type: "js_binary",
        labels: ["lang:node", "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
      },
      {
        name: "//projects/apps/pytool:missing_kind",
        rule_type: "python_binary",
        labels: ["lang:python", "lockfile:projects/apps/pytool/uv.lock#projects/apps/pytool"],
        srcs: ["main.py"],
      },

      // Malformed lockfile label
      {
        name: "//projects/apps/web:malformed_label",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle", "lockfile:projects/apps/web/pnpm-lock.yaml"],
      },
      {
        name: "//projects/apps/pytool:malformed_label",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin", "lockfile:projects/apps/pytool/uv.lock"],
        srcs: ["main.py"],
      },

      // Unsupported importer root on auto-attach path (nearest lockfile exists, but importer is unsupported)
      {
        name: "//services/api:bundle",
        rule_type: "js_binary",
        labels: ["lang:node", "kind:bundle"],
      },
      {
        name: "//services/api:tool",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["main.py"],
      },
    ];
    const sim = path.join(tmp, "viberoots/build-tools/tools/buck/simulated.json");
    await fs.outputFile(sim, JSON.stringify(nodes) + "\n");

    const out = path.join(tmp, "viberoots/build-tools/tools/buck/.tmp.graph.json");
    await fs.mkdirp(path.dirname(out));
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${out} --validation warn`;
    const txt = String(res.stdout || "") + String(res.stderr || "");
    if (res.exitCode !== 0) {
      console.error("exporter should succeed in warn mode", txt);
      process.exit(2);
    }

    mustInclude(txt, "validation warnings");

    mustInclude(txt, "[exporter][node]");
    mustInclude(txt, "[exporter][python]");

    mustInclude(txt, "[exporter][node] missing kind:* label");
    mustInclude(txt, "[exporter][python] missing kind:* label");

    mustInclude(txt, "[exporter][node] malformed lockfile label");
    mustInclude(txt, "[exporter][python] malformed lockfile label");

    mustInclude(txt, "[exporter][node] nearest lockfile is under an unsupported importer root");
    mustInclude(txt, "[exporter][python] nearest lockfile is under an unsupported importer root");
  });
});
