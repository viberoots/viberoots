#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-macro-stamp-test", async (tmp, $) => {
  const app = path.join(tmp, "apps", "demo");
  await fs.mkdirp(path.join(app, "src"));
  await fs.outputFile(path.join(app, "src", "main.cpp"), "int main(){return 0;}\n");
  await fs.outputFile(path.join(tmp, "cpp", "defs.bzl"), await fs.readFile("cpp/defs.bzl", "utf8"));
  await fs.outputFile(
    path.join(tmp, "cpp", "wasm_defs.bzl"),
    await fs.readFile("cpp/wasm_defs.bzl", "utf8"),
  );
  await fs.outputFile(
    path.join(app, "TARGETS"),
    [
      'load("//cpp:defs.bzl", "nix_cpp_test")',
      "",
      "nix_cpp_test(",
      '  name = "demo_test",',
      '  srcs = ["src/main.cpp"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  const graph = path.join(tmp, "tools/buck/graph.json");
  const nodesSim = [{ name: "//apps/demo:demo_test", rule_type: "cxx_test", labels: [] }];
  await fs.mkdirp(path.dirname(graph));
  await fs.outputFile(graph, JSON.stringify(nodesSim) + "\n", "utf8");
  await $({ cwd: tmp })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph}`;

  const after = (await readGraph(graph)) as any[];
  const node = after.find((n) => n.name === "//apps/demo:demo_test");
  const labs: string[] = node?.labels || [];
  assert.ok(labs.includes("lang:cpp"));
  assert.ok(labs.includes("kind:test"));
});
