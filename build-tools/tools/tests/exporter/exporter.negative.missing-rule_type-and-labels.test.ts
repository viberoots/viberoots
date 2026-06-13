#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter fails when Go-like node lacks rule_type and lang:go", async () => {
  await runInTemp("exp-missing-classification", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(
      path.join(mod, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.outputFile(path.join(mod, "main.go"), "package main\nfunc main(){}\n", "utf8");

    // Missing rule_type and labels, but has .go srcs
    const nodes = [{ name: "//mod:bin", srcs: ["main.go"] }];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const res = await $({
      cwd: tmp,
      reject: false,
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`.exitCode;
    if (res === 0) {
      console.error("expected exporter to fail but it succeeded");
      process.exit(2);
    }
  });
});
