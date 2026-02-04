#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go adapter validate fails when .go sources lack rule_type and lang:go", async () => {
  await runInTemp("exp-go-missing-classification", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(
      path.join(mod, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.outputFile(path.join(mod, "main.go"), "package main\nfunc main(){}\n", "utf8");

    // Node has .go srcs but no rule_type and no labels
    const nodes = [{ name: "//mod:bin", srcs: ["main.go"] }];
    const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const code = await $({
      cwd: tmp,
      reject: false,
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`.exitCode;
    if (code === 0) {
      console.error("expected exporter to fail but it succeeded");
      process.exit(2);
    }
  });
});
