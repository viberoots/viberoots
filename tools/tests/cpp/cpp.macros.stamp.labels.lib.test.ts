#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-macro-stamp-lib", async (tmp, $) => {
  // Minimal C++ lib under libs/demo
  const pkg = path.join(tmp, "libs", "demo");
  await fs.mkdirp(path.join(pkg, "src"));
  await fs.outputFile(path.join(pkg, "src", "demo.cpp"), "int add(int a,int b){return a+b;}\n");
  await fs.outputFile(path.join(tmp, "cpp", "defs.bzl"), await fs.readFile("cpp/defs.bzl", "utf8"));
  await fs.outputFile(
    path.join(pkg, "TARGETS"),
    [
      'load("//cpp:defs.bzl", "nix_cpp_library")',
      "",
      "nix_cpp_library(",
      '  name = "demo",',
      '  srcs = ["src/demo.cpp"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const graph = path.join(tmp, "tools/buck/graph.json");
  const nodesSim = [{ name: "//libs/demo:demo", rule_type: "cxx_library", labels: [] }];
  await fs.mkdirp(path.dirname(graph));
  await fs.outputFile(graph, JSON.stringify(nodesSim) + "\n", "utf8");
  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const after = (await readGraph(graph)) as any[];
  const node = after.find((n) => n.name === "//libs/demo:demo");
  const labs: string[] = node?.labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:lib"));
});
