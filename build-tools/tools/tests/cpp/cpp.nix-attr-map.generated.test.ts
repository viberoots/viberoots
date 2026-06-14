#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("inspect-cpp-attrs lists nixpkg attrs from graph nodes", async () => {
  await runInTemp("cpp-inspect-attrs", async (tmp, $) => {
    // Minimal graph with two attrs (kept literal to reflect exporter output)
    const graph = [
      { name: "//projects/apps/a:bin", labels: ["lang:cpp", "nixpkg:pkgs.zlib"] },
      { name: "//projects/apps/b:test", labels: ["lang:cpp", "nixpkg:pkgs.gtest"] },
    ];
    await fs.outputFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(graph),
      "utf8",
    );

    const cli = path.join(process.cwd(), "build-tools/tools/buck/inspect-cpp-attrs.ts");
    const { stdout } = await $({ cwd: tmp, stdio: "pipe" })`node ${cli} --json`;
    const data = JSON.parse(String(stdout || "{}"));
    const targets = (data && data.targets) || {};
    const a = targets["//projects/apps/a:bin"] || [];
    const b = targets["//projects/apps/b:test"] || [];
    if (!a.includes("pkgs.zlib")) {
      console.error("expected pkgs.zlib in //projects/apps/a:bin attrs");
      process.exit(2);
    }
    if (!b.includes("pkgs.gtest")) {
      console.error("expected pkgs.gtest in //projects/apps/b:test attrs");
      process.exit(2);
    }
  });
});
