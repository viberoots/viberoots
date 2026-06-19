#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("exporter-adapters-inactive", async (tmp, $) => {
  const langDir = path.join(tmp, "viberoots/build-tools/tools/buck/exporter/lang");
  await fs.mkdirp(langDir);
  // Only provide go adapter; omit cpp adapter to simulate inactive adapter scenario
  const goSrc = await fs.readFile("viberoots/build-tools/tools/buck/exporter/lang/go.ts", "utf8");
  await fs.writeFile(path.join(langDir, "go.ts"), goSrc, "utf8");

  const nodes = [
    { name: "//projects/apps/go:svc", rule_type: "go_binary", labels: ["lang:go"] },
    { name: "//projects/apps/cpp:tool", rule_type: "cxx_binary", labels: [] },
  ];
  const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
  await fs.outputFile(graph, JSON.stringify(nodes) + "\n", "utf8");

  // Run exporter in simulate mode from the temp repo
  await $({
    cwd: tmp,
  })`EXPORTER_ADAPTERS=go node viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const out = (await readGraph(graph)) as any[];
  const by = new Map(out.map((n) => [n.name, n]));
  const goSvc = by.get("//projects/apps/go:svc");
  const cppTool = by.get("//projects/apps/cpp:tool");
  assert.ok((goSvc.labels || []).includes("lang:go"));
  // cpp adapter is missing, so cpp labels should not be added; ensure it's unchanged
  assert.ok(!(cppTool.labels || []).includes("lang:cpp"));
});
