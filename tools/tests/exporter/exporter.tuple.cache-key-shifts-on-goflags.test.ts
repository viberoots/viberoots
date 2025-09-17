#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter tuple differs when GOFLAGS -tags changes", async () => {
  await runInTemp("exp-cache-goflags", async (tmp, $) => {
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
    const graph = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const m1 = path.join(tmp, "m1.json");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${m1}`;
    const t1: string[] = JSON.parse(await fs.readFile(m1, "utf8")).tupleKeys || [];

    const m2 = path.join(tmp, "m2.json");
    const env = { ...process.env, GOFLAGS: "-tags=x" } as any;
    await $({
      cwd: tmp,
      stdio: "inherit",
      env,
    })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${m2}`;
    const t2: string[] = JSON.parse(await fs.readFile(m2, "utf8")).tupleKeys || [];

    if (JSON.stringify(t1) === JSON.stringify(t2)) {
      console.error("expected tupleKeys to differ when GOFLAGS -tags changes", { t1, t2 });
      process.exit(2);
    }
  });
});
