#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("export-graph-attach-modules-local-replace", async (tmp, $) => {
  // Create minimal Go module A and module B, with A replacing B locally.
  const modA = path.join(tmp, "apps", "a");
  const modB = path.join(tmp, "apps", "b");
  await fs.mkdirp(path.join(modA));
  await fs.mkdirp(path.join(modB));

  // Module B (library)
  await fs.outputFile(
    path.join(modB, "go.mod"),
    ["module example.com/modb", "", "go 1.22", ""].join("\n"),
  );
  await fs.outputFile(
    path.join(modB, "b.go"),
    ["package b", "", "func V() int { return 42 }", ""].join("\n"),
  );

  // Module A (app) that does NOT import modb in library code.
  await fs.outputFile(
    path.join(modA, "go.mod"),
    [
      "module example.com/appa",
      "",
      "go 1.22",
      "",
      "require example.com/modb v0.0.0-00010101000000-000000000000",
      `replace example.com/modb => ../b`,
      "",
    ].join("\n"),
  );
  await fs.outputFile(
    path.join(modA, "main.go"),
    ["package main", "", "func main() {}", ""].join("\n"),
  );
  await fs.outputFile(
    path.join(modA, "main_test.go"),
    [
      "package main",
      "",
      'import (\n  "testing"\n  b "example.com/modb"\n)',
      "",
      "func TestUsesB(t *testing.T) {",
      '  if b.V() != 42 { t.Fatal("want 42") }',
      "}",
      "",
    ].join("\n"),
  );

  // Buck TARGETS — use filegroup to avoid requiring go prelude in tests.
  const targetsA = [
    "filegroup(",
    '    name = "appa_lib",',
    '    srcs = ["main.go"],',
    '    labels = ["lang:go"],',
    ")",
    "",
    "filegroup(",
    '    name = "appa_test",',
    '    srcs = ["main_test.go"],',
    '    labels = ["lang:go"],',
    ")",
    "",
  ].join("\n");
  await fs.outputFile(path.join(modA, "TARGETS"), targetsA);

  // Simulate nodes instead of relying on Buck prelude
  const nodes = [
    { name: "//apps/a:appa_lib", rule_type: "filegroup", labels: ["lang:go"], srcs: ["main.go"] },
    {
      name: "//apps/a:appa_test",
      rule_type: "filegroup",
      labels: ["lang:go"],
      srcs: ["main_test.go"],
    },
  ];
  await fs.outputFile(path.join(tmp, "sim.json"), JSON.stringify(nodes));
  await $`node tools/buck/export-graph.ts --simulate sim.json --out tools/buck/graph.json`;
  const graph = JSON.parse(await fs.readFile(path.join(tmp, "tools/buck/graph.json"), "utf8"));

  // Find nodes and assert module labels only on test target
  const find = (name: string) => graph.find((n: any) => n.name.endsWith(name));
  const lib = find(":appa_lib");
  const tst = find(":appa_test");
  if (!lib || !tst) {
    console.error(graph.map((n: any) => n.name));
    throw new Error("expected appa_lib and appa_test in graph nodes");
  }
  const hasModB = (labels: string[]) =>
    (labels || []).some((l) => l.startsWith("module:example.com/modb@"));
  if (hasModB(lib.labels || [])) {
    throw new Error("lib should not have modb module label (only tests import it)");
  }
  if (!hasModB(tst.labels || [])) {
    throw new Error("test should have modb module label");
  }
});
