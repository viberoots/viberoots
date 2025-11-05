#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("export-graph-attach-modules-test-only", async (tmp, $) => {
  const mod = path.join(tmp, "pkg");
  await fs.mkdirp(mod);

  await fs.outputFile(
    path.join(mod, "go.mod"),
    [
      "module example.com/x",
      "",
      "go 1.22",
      "",
      "require github.com/stretchr/testify v1.8.4",
      "",
    ].join("\n"),
  );
  await fs.outputFile(
    path.join(mod, "x.go"),
    ["package x", "", "func A() int { return 1 }", ""].join("\n"),
  );
  await fs.outputFile(
    path.join(mod, "x_test.go"),
    [
      "package x",
      "",
      'import (\n  "testing"\n  "github.com/stretchr/testify/require"\n)',
      "",
      "func TestA(t *testing.T) { require.Equal(t, 1, A()) }",
      "",
    ].join("\n"),
  );

  const targets = [
    "filegroup(",
    '    name = "x_lib",',
    '    srcs = ["x.go"],',
    '    labels = ["lang:go"],',
    ")",
    "",
    "filegroup(",
    '    name = "x_test",',
    '    srcs = ["x_test.go"],',
    '    labels = ["lang:go"],',
    ")",
    "",
  ].join("\n");
  await fs.outputFile(path.join(mod, "TARGETS"), targets);

  // Build a simulated node set to avoid requiring Buck prelude in test temp repo
  const nodes = [
    { name: "//pkg:x_lib", rule_type: "filegroup", labels: ["lang:go"], srcs: ["x.go"] },
    { name: "//pkg:x_test", rule_type: "filegroup", labels: ["lang:go"], srcs: ["x_test.go"] },
  ];
  await fs.outputFile(path.join(tmp, "sim.json"), JSON.stringify(nodes));
  await $`node tools/buck/export-graph.ts --simulate sim.json --out tools/buck/graph.json`;
  const graph = await readGraph(path.join(tmp, "tools/buck/graph.json"));
  const find = (name: string) => graph.find((n: any) => n.name.endsWith(name));
  const lib = find(":x_lib");
  const tst = find(":x_test");
  if (!lib || !tst) throw new Error("expected x_lib and x_test");
  const hasTestify = (labels: string[]) =>
    (labels || []).some((l) => l.startsWith("module:github.com/stretchr/testify@"));
  if (hasTestify(lib.labels || [])) throw new Error("lib should not have testify module label");
  if (!hasTestify(tst.labels || [])) throw new Error("test should have testify module label");
});
