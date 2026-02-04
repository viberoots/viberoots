#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter tuple includes toolchain hash or 'unknown' and exposes in metrics", async () => {
  await runInTemp("exp-tuple-toolchain", async (tmp, $) => {
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
    const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const metrics = path.join(tmp, "metrics.json");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics}`;
    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    const keys: string[] = m.tupleKeys || [];
    if (!Array.isArray(keys) || keys.length === 0) {
      console.error("expected tupleKeys in metrics");
      process.exit(2);
    }
    if (!keys.some((k) => /\|unknown$/.test(k) || /\|[a-f0-9]{12}$/.test(k))) {
      console.error("expected toolchain suffix to be 'unknown' or a 12-hex hash", keys);
      process.exit(2);
    }
  });
});
