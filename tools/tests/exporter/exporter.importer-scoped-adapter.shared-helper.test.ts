#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import nodeAdapter from "../../buck/exporter/lang/node.ts";
import pythonAdapter from "../../buck/exporter/lang/python.ts";

function mustFind(nodes: Array<{ name: string; labels?: string[] }>, name: string) {
  const found = nodes.find((n) => n.name === name);
  assert.ok(found, `missing node: ${name}`);
  return found as { name: string; labels?: string[] };
}

test("importer-scoped adapter helper keeps node/python attach + validate behavior aligned", async () => {
  await runInTemp("exp-importer-scoped-adapter-shared", async (tmp) => {
    await fs.mkdirp(path.join(tmp, "apps", "web"));
    await fs.outputFile(
      path.join(tmp, "apps", "web", "pnpm-lock.yaml"),
      'lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}\n',
      "utf8",
    );

    await fs.mkdirp(path.join(tmp, "apps", "pytool"));
    await fs.outputFile(path.join(tmp, "apps", "pytool", "uv.lock"), "# uv lock\n", "utf8");

    const prev = process.cwd();
    try {
      process.chdir(tmp);

      const attachNodes = [
        {
          name: "//apps/web:lib",
          rule_type: "js_library",
          labels: ["lang:node", "kind:lib"],
        },
        {
          name: "//apps/pytool:lib",
          rule_type: "python_library",
          labels: ["lang:python", "kind:lib"],
          srcs: ["lib.py"],
        },
      ];
      const nodeAttached = await nodeAdapter.attachLabels(attachNodes, [], "");
      const pythonAttached = await pythonAdapter.attachLabels(attachNodes, [], "");

      const nodeLabels = new Set(mustFind(nodeAttached, "//apps/web:lib").labels || []);
      assert.ok(
        nodeLabels.has("lockfile:apps/web/pnpm-lock.yaml#apps/web"),
        "node lockfile label missing",
      );

      const pythonLabels = new Set(mustFind(pythonAttached, "//apps/pytool:lib").labels || []);
      assert.ok(
        pythonLabels.has("lockfile:apps/pytool/uv.lock#apps/pytool"),
        "python lockfile label missing",
      );

      const validateNodes = [
        {
          name: "//apps/web:missing_kind",
          rule_type: "js_binary",
          labels: ["lang:node", "lockfile:apps/web/pnpm-lock.yaml#apps/web"],
        },
        {
          name: "//apps/pytool:missing_kind",
          rule_type: "python_binary",
          labels: ["lang:python", "lockfile:apps/pytool/uv.lock#apps/pytool"],
          srcs: ["main.py"],
        },
      ];
      const nodeFindings = (await nodeAdapter.validate?.(validateNodes)) || [];
      const pythonFindings = (await pythonAdapter.validate?.(validateNodes)) || [];

      assert.ok(
        nodeFindings.some((f) => f.includes("[exporter][node] missing kind:* label")),
        "node missing kind finding not emitted",
      );
      assert.ok(
        pythonFindings.some((f) => f.includes("[exporter][python] missing kind:* label")),
        "python missing kind finding not emitted",
      );
    } finally {
      process.chdir(prev);
    }
  });
});
