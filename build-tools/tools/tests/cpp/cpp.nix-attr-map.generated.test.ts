#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("inspect-cpp-attrs lists nixpkg attrs from graph nodes", async () => {
  await runInTemp("cpp-inspect-attrs", async (tmp, $) => {
    // Minimal graph with two attrs (kept literal to reflect exporter output)
    const graph = [
      { name: "//apps/a:bin", labels: ["lang:cpp", "nixpkg:pkgs.zlib"] },
      { name: "//apps/b:test", labels: ["lang:cpp", "nixpkg:pkgs.gtest"] },
    ];
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      JSON.stringify(graph),
      "utf8",
    );

    const cli = path.join(process.cwd(), "build-tools/tools/buck/inspect-cpp-attrs.ts");
    const { stdout } = await $({ cwd: tmp, stdio: "pipe" })`node ${cli} --json`;
    const data = JSON.parse(String(stdout || "{}"));
    const targets = (data && data.targets) || {};
    const a = targets["//apps/a:bin"] || [];
    const b = targets["//apps/b:test"] || [];
    if (!a.includes("pkgs.zlib")) {
      console.error("expected pkgs.zlib in //apps/a:bin attrs");
      process.exit(2);
    }
    if (!b.includes("pkgs.gtest")) {
      console.error("expected pkgs.gtest in //apps/b:test attrs");
      process.exit(2);
    }
  });
});

