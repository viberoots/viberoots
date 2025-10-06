#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exporter-mixed-lang-merge", async (tmp, $) => {
  const nodes = [
    { name: "//apps/go:svc", rule_type: "go_binary", labels: ["lang:go"] },
    { name: "//libs/go:lib", rule_type: "go_library", labels: ["lang:go"] },
    { name: "//apps/cpp:tool", rule_type: "cxx_binary", labels: [] },
  ];
  const graph = path.join(tmp, "tools/buck/graph.json");
  await fs.outputFile(graph, JSON.stringify(nodes) + "\n", "utf8");

  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const after = JSON.parse(await fs.readFile(graph, "utf8")) as any[];
  const by = new Map(after.map((n) => [n.name, n]));
  const goLib = by.get("//libs/go:lib");
  const goSvc = by.get("//apps/go:svc");
  const cppTool = by.get("//apps/cpp:tool");
  assert.ok((goLib.labels || []).includes("lang:go"));
  assert.ok((goSvc.labels || []).includes("lang:go"));
  assert.ok((cppTool.labels || []).includes("lang:cpp"));
  assert.ok((cppTool.labels || []).includes("kind:bin"));
});
