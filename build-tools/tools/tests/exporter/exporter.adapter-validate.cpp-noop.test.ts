#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

test("cpp adapter validate is a no-op and export succeeds", async () => {
  await runInTemp("exp-cpp-validate-noop", async (tmp, $) => {
    const pkg = path.join(tmp, "cpp", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.cpp"), "int main(){return 0;}\n", "utf8");

    // Minimal node resembling a cxx_binary without labels; cpp validate should not fail
    const nodes = [
      { name: "//cpp/app:bin", rule_type: "cxx_binary", srcs: ["cpp/app/main.cpp"], labels: [] },
    ];
    const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const res = await $({
      cwd: tmp,
      reject: false,
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;
    if (res.exitCode !== 0) {
      console.error(
        "expected exporter to succeed for C++ nodes but it failed:\n",
        String(res.stderr || ""),
      );
      process.exit(2);
    }

    // Ensure output wrote normalized nodes
    const out = await readGraph(graph);
    if (!Array.isArray(out) || !out.find((n: any) => (n as any).name === "//cpp/app:bin")) {
      console.error("exporter did not write expected node list");
      process.exit(2);
    }
  });
});
