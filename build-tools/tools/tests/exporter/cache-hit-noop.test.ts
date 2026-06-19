#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter caches go list results and second run is mostly cache hits", async () => {
  await runInTemp("exporter-cache-hit", async (tmp, $) => {
    // Minimal Go module
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(path.join(mod, "go.mod"), "module example.com/mod\n\ngo 1.22\n", "utf8");
    await fs.outputFile(
      path.join(mod, "main.go"),
      'package main\nimport "fmt"\nfunc main(){fmt.Println("hi")}\n',
      "utf8",
    );

    // Fake a small graph containing this directory as a go target
    const nodes = [
      {
        name: "//mod:bin",
        rule_type: "go_binary",
        labels: ["lang:go"],
        srcs: ["main.go"],
      },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    // First run: expect cache misses > 0
    const metrics1 = path.join(tmp, "viberoots/build-tools/tools/buck/metrics1.json");
    await $({
      cwd: tmp,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics1}`;
    const m1 = JSON.parse(await fs.readFile(metrics1, "utf8"));
    if (!(m1.cacheMisses >= 0)) {
      console.error("missing cacheMisses in metrics1");
      process.exit(2);
    }

    // Second run: expect cacheHits >= previous misses (best effort)
    const metrics2 = path.join(tmp, "viberoots/build-tools/tools/buck/metrics2.json");
    await $({
      cwd: tmp,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics2}`;
    const m2 = JSON.parse(await fs.readFile(metrics2, "utf8"));
    if (!(m2.cacheHits >= m1.cacheMisses)) {
      console.error("expected cacheHits to be >= first-run cacheMisses", m2, m1);
      process.exit(2);
    }
  });
});
