#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-macro-stamp-bin", async (tmp, $) => {
  const app = path.join(tmp, "apps", "demo");
  await fs.mkdirp(path.join(app, "src"));
  await fs.outputFile(path.join(app, "src", "main.cpp"), "int main(){return 0;}\n");
  await fs.outputFile(path.join(tmp, "cpp", "defs.bzl"), await fs.readFile("cpp/defs.bzl", "utf8"));
  await fs.outputFile(
    path.join(app, "TARGETS"),
    [
      'load("//cpp:defs.bzl", "nix_cpp_binary")',
      "",
      "nix_cpp_binary(",
      '  name = "demo",',
      '  srcs = ["src/main.cpp"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const graph = path.join(tmp, "tools/buck/graph.json");
  const nodesSim = [{ name: "//apps/demo:demo", rule_type: "cxx_binary", labels: [] }];
  await fs.mkdirp(path.dirname(graph));
  await fs.outputFile(graph, JSON.stringify(nodesSim) + "\n", "utf8");
  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const after = JSON.parse(await fs.readFile(graph, "utf8")) as any[];
  const node = after.find((n) => n.name === "//apps/demo:demo");
  const labs: string[] = node?.labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:bin"));
});
