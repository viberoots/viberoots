#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph";
import { runInTemp } from "../lib/test-helpers";

test("exporter attaches test-only deps only to test targets", async () => {
  await runInTemp("exp-test-only", async (tmp, $) => {
    const dir = path.join(tmp, "m");
    await fs.mkdirp(dir);
    await fs.outputFile(
      path.join(dir, "go.mod"),
      "module example.com/m\n\ngo 1.22\nrequire github.com/stretchr/testify v1.9.0\n",
      "utf8",
    );
    await fs.outputFile(path.join(dir, "lib.go"), "package m\nfunc X(){}\n", "utf8");
    await fs.outputFile(
      path.join(dir, "lib_test.go"),
      'package m\nimport (\n\t"testing"\n\t"github.com/stretchr/testify/require"\n)\nfunc TestX(t *testing.T){ require.True(t,true) }\n',
      "utf8",
    );

    // Simulated exporter run to avoid Buck prelude dependencies
    const nodesSim = [
      { name: "//m:lib", rule_type: "go_library", labels: ["lang:go"], srcs: ["lib.go"] },
      { name: "//m:lib_test", rule_type: "go_test", labels: ["lang:go"], srcs: ["lib_test.go"] },
    ];
    const nodesPath = path.join(tmp, "nodes.json");
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.outputFile(nodesPath, JSON.stringify(nodesSim, null, 2), "utf8");
    await $({
      cwd: tmp,
    })`build-tools/tools/buck/export-graph.ts --simulate ${nodesPath} --out ${graphPath}`;
    const nodes = await readGraph(graphPath);
    function labelsOf(n: any): string[] {
      return (n.labels || []).filter((x: string) => x.startsWith("module:"));
    }
    const byName = new Map(nodes.map((n: any) => [n.name, n]));
    const lLib = labelsOf(byName.get("//m:lib"));
    const lTest = labelsOf(byName.get("//m:lib_test"));
    const hasTestify = (arr: string[]) =>
      arr.some((s) => s.startsWith("module:github.com/stretchr/testify@"));
    if (hasTestify(lLib)) {
      console.error("library target unexpectedly labeled with test-only module");
      process.exit(2);
    }
    if (!hasTestify(lTest)) {
      console.error("test target missing testify module label");
      process.exit(2);
    }
  });
});
