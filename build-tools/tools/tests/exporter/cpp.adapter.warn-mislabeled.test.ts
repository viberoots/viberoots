#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp adapter emit warning for C++-looking srcs missing cxx_* and lang:cpp", async () => {
  await runInTemp("exp-cpp-warn-mislabeled", async (tmp, $) => {
    const pkg = path.join(tmp, "viberoots", "build-tools", "cpp", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.cpp"), "int main(){return 0;}\n", "utf8");

    // Node with .cpp srcs but neither cxx_* rule_type nor 'lang:cpp' label
    const nodes = [
      {
        name: "//viberoots/build-tools/cpp/app:bin",
        srcs: ["viberoots/build-tools/cpp/app/main.cpp"],
        labels: [],
      },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    let out = "";
    let code = 0;
    try {
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
      })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --validation warn`;
      out = String(res.stdout || "") + String(res.stderr || "");
      code = res.exitCode || 0;
    } catch (e: any) {
      out = String(e?.stdout || "") + String(e?.stderr || "");
      code = typeof e?.exitCode === "number" ? e.exitCode : 1;
    }

    if (code !== 0) {
      console.error("exporter should succeed (warn-only)", out);
      process.exit(2);
    }
    // Aggregated warnings header and adapter-specific message
    if (!out.includes("validation warnings") || !out.includes("[exporter][cpp]")) {
      console.error("expected aggregated validation warnings including cpp adapter message\n", out);
      process.exit(2);
    }
  });
});
