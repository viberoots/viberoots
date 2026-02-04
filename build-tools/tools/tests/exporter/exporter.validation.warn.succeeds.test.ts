#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter --validation=warn prints warnings and exits zero", async () => {
  await runInTemp("exp-warn-succeeds", async (tmp, $) => {
    const pkg = path.join(tmp, "build-tools", "go", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.go"), "package main\nfunc main(){}\n", "utf8");

    // Node with .go srcs but no rule_type and no labels triggers a go finding
    const nodes = [
      { name: "//build-tools/go/app:bin", srcs: ["build-tools/go/app/main.go"], labels: [] },
    ];
    const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const res = await $({
      cwd: tmp,
      reject: false,
      stdio: "pipe",
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --validation warn`;
    const out = String(res.stdout || "") + String(res.stderr || "");
    if (res.exitCode !== 0) {
      console.error("expected exporter to succeed in warn mode", out);
      process.exit(2);
    }
    if (!out.includes("validation warnings") || !out.includes("[exporter][go]")) {
      console.error("expected aggregated warnings including go adapter message", out);
      process.exit(2);
    }
  });
});
