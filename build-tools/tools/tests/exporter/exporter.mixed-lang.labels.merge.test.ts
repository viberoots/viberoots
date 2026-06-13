#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exporter-mixed-lang-merge", async (tmp, $) => {
  const nodes = [
    { name: "//projects/apps/go:svc", rule_type: "go_binary", labels: ["lang:go"] },
    { name: "//projects/libs/go:lib", rule_type: "go_library", labels: ["lang:go"] },
    { name: "//projects/apps/cpp:tool", rule_type: "cxx_binary", labels: [] },
  ];
  const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
  await fs.outputFile(graph, JSON.stringify(nodes) + "\n", "utf8");

  await $({ cwd: tmp })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const after = (await readGraph(graph)) as any[];
  const by = new Map(after.map((n) => [n.name, n]));
  const goLib = by.get("//projects/libs/go:lib");
  const goSvc = by.get("//projects/apps/go:svc");
  const cppTool = by.get("//projects/apps/cpp:tool");
  assert.ok((goLib.labels || []).includes("lang:go"));
  assert.ok((goSvc.labels || []).includes("lang:go"));
  assert.ok((cppTool.labels || []).includes("lang:cpp"));
  assert.ok((cppTool.labels || []).includes("kind:bin"));
});
