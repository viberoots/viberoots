#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp adapter emit warning for C++-looking srcs missing cxx_* and lang:cpp", async () => {
  await runInTemp("exp-cpp-warn-mislabeled", async (tmp, $) => {
    const pkg = path.join(tmp, "cpp", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.cpp"), "int main(){return 0;}\n", "utf8");

    // Node with .cpp srcs but neither cxx_* rule_type nor 'lang:cpp' label
    const nodes = [{ name: "//cpp/app:bin", srcs: ["cpp/app/main.cpp"], labels: [] }];
    const graph = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    let out = "";
    let code = 0;
    try {
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
      })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;
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
    if (!out.includes("[exporter][cpp] warning") || !out.includes("lang:cpp")) {
      console.error("expected warn-only message about missing 'lang:cpp' or cxx_*\n", out);
      process.exit(2);
    }
  });
});
