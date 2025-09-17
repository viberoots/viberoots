#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("per-target gotags affect tuple and labels only for tagged target", async () => {
  await runInTemp("exp-per-target-tags", async (tmp, $) => {
    // Minimal module
    await fs.outputFile(
      path.join(tmp, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.mkdirp(path.join(tmp, "pkg"));
    await fs.outputFile(path.join(tmp, "pkg", "main.go"), "package pkg\nfunc F(){}\n", "utf8");

    // Simulated graph: two targets; one carries gotags label
    const nodes = [
      {
        name: "//pkg:lib_default",
        rule_type: "go_library",
        labels: ["lang:go"],
        srcs: ["pkg/main.go"],
      },
      {
        name: "//pkg:lib_tagged",
        rule_type: "go_library",
        labels: ["lang:go", "gotags:debug,s3"],
        srcs: ["pkg/main.go"],
      },
    ];

    // Export graph with metrics
    const graph = path.join(tmp, "tools/buck/graph.json");
    const metrics = path.join(tmp, "metrics.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.writeFile(graph, JSON.stringify(nodes, null, 2), "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics}`;

    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    const keys: string[] = m.tupleKeys || [];
    if (!keys.some((k: string) => k.includes("debug,s3"))) {
      console.error("expected tupleKeys to include gotags:debug,s3");
      process.exit(2);
    }

    // Ensure only lib_tagged carries the gotags label (we set it)
    const outNodes = JSON.parse(await fs.readFile(graph, "utf8"));
    const tDefault = outNodes.find((n: any) => n.name.endsWith(":lib_default"));
    const tTagged = outNodes.find((n: any) => n.name.endsWith(":lib_tagged"));
    if ((tDefault?.labels || []).some((l: string) => l.startsWith("gotags:"))) {
      console.error("default target should not carry gotags label");
      process.exit(2);
    }
    if (!(tTagged?.labels || []).some((l: string) => l.startsWith("gotags:"))) {
      console.error("tagged target should carry gotags label");
      process.exit(2);
    }
  });
});
