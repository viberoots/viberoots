#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("per-target GOOS/GOARCH split batches via labels", async () => {
  await runInTemp("exp-per-target-platform", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.mkdirp(path.join(tmp, "pkg"));
    await fs.outputFile(path.join(tmp, "pkg", "main.go"), "package pkg\nfunc F(){}\n", "utf8");

    const targets = [
      "genrule(name='lib_default', srcs=['pkg/main.go'], out='a.stamp', cmd=': > $OUT', labels=['lang:go'])",
      "genrule(name='lib_linux_amd64', srcs=['pkg/main.go'], out='b.stamp', cmd=': > $OUT', labels=['lang:go','goenv:GOOS=linux','goenv:GOARCH=amd64'])",
      "",
    ].join("\n");
    const nodes = [
      {
        name: "//pkg:lib_default",
        rule_type: "go_library",
        labels: ["lang:go"],
        srcs: ["pkg/main.go"],
      },
      {
        name: "//pkg:lib_linux_amd64",
        rule_type: "go_library",
        labels: ["lang:go", "goenv:GOOS=linux", "goenv:GOARCH=amd64"],
        srcs: ["pkg/main.go"],
      },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const metrics = path.join(tmp, "metrics.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.writeFile(graph, JSON.stringify(nodes, null, 2), "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${metrics}`;

    const m = JSON.parse(await fs.readFile(metrics, "utf8"));
    const keys: string[] = m.tupleKeys || [];
    const hasLinuxAmd64 = keys.some(
      (k: string) => k.includes("linux|amd64") || (k.includes("linux") && k.includes("amd64")),
    );
    if (!hasLinuxAmd64) {
      console.error("expected a tupleKey reflecting GOOS=linux and GOARCH=amd64");
      process.exit(2);
    }
  });
});
