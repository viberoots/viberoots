#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

test("exporter labels use Module.Replace when present", async () => {
  await runInTemp("exporter-replace", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    // go.mod with replace
    await fs.outputFile(
      path.join(mod, "go.mod"),
      [
        "module example.com/app",
        "",
        "go 1.22",
        "",
        "require golang.org/x/net v0.24.0",
        "replace golang.org/x/net v0.24.0 => golang.org/x/net v0.25.0",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(mod, "main.go"),
      'package main\nimport _ "golang.org/x/net/context"\nfunc main(){}\n',
      "utf8",
    );

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

    // Use simulate mode for hermetic parsing of imports + go.mod replace
    await $({
      cwd: tmp,
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;
    const outNodes = await readGraph(graph);
    const target = outNodes.find((n: any) => n.name === "//mod:bin");
    const labels: string[] = target?.labels || [];
    const has = labels.some((l) => l.startsWith("module:golang.org/x/net@v0.25.0"));
    if (!has) {
      console.error("expected label with replaced version v0.25.0 in", labels);
      process.exit(2);
    }
  });
});
