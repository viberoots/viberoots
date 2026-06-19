#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter tuple includes -tags from GOFLAGS and metrics shows tupleKeys", async () => {
  await runInTemp("exp-tuple-goflags", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(
      path.join(mod, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.outputFile(path.join(mod, "main.go"), "package main\nfunc main(){}\n", "utf8");

    const nodes = [
      { name: "//mod:bin", rule_type: "go_binary", labels: ["lang:go"], srcs: ["main.go"] },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const metrics = path.join(tmp, "metrics.json");
    const env = { ...process.env, GOFLAGS: "-tags=foo,bar" } as any;
    await $({
      cwd: tmp,
      stdio: "inherit",
      env,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics}`;
    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    const keys: string[] = m.tupleKeys || [];
    if (!Array.isArray(keys) || keys.length === 0) {
      console.error("expected tupleKeys in metrics");
      process.exit(2);
    }
    const joined = keys.join("\n");
    if (!/bar,foo/.test(joined)) {
      console.error("expected sorted tags 'bar,foo' present in tupleKeys, got:", joined);
      process.exit(2);
    }
  });
});
