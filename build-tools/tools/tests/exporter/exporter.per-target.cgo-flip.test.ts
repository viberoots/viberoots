#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("per-target cgo_enabled flips only the tuple cgo segment", async () => {
  await runInTemp("exp-per-target-cgo", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "go.mod"),
      ["module example.com/app", "", "go 1.22"].join("\n"),
      "utf8",
    );
    await fs.mkdirp(path.join(tmp, "pkg"));
    await fs.outputFile(path.join(tmp, "pkg", "main.go"), "package pkg\nfunc F(){}\n", "utf8");

    const t1 = [
      "genrule(name='lib_cgo_on', srcs=['pkg/main.go'], out='a.stamp', cmd=': > $OUT', labels=['lang:go','goenv:CGO_ENABLED=1'])",
      "",
    ].join("\n");
    const nodes1 = [
      {
        name: "//pkg:lib_cgo_on",
        rule_type: "go_library",
        labels: ["lang:go", "goenv:CGO_ENABLED=1"],
        srcs: ["pkg/main.go"],
      },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const m1 = path.join(tmp, "m1.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.writeFile(graph, JSON.stringify(nodes1, null, 2), "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${m1}`;
    const keys1: string[] = JSON.parse(await fs.readFile(m1, "utf8")).tupleKeys || [];

    const t2 = [
      "genrule(name='lib_cgo_off', srcs=['pkg/main.go'], out='b.stamp', cmd=': > $OUT', labels=['lang:go','goenv:CGO_ENABLED=0'])",
      "",
    ].join("\n");
    const nodes2 = [
      {
        name: "//pkg:lib_cgo_off",
        rule_type: "go_library",
        labels: ["lang:go", "goenv:CGO_ENABLED=0"],
        srcs: ["pkg/main.go"],
      },
    ];
    const m2 = path.join(tmp, "m2.json");
    await fs.writeFile(graph, JSON.stringify(nodes2, null, 2), "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --metrics-out ${m2}`;
    const keys2: string[] = JSON.parse(await fs.readFile(m2, "utf8")).tupleKeys || [];

    if (JSON.stringify(keys1) === JSON.stringify(keys2)) {
      console.error("expected tupleKeys to differ when cgo_enabled flips");
      process.exit(2);
    }
  });
});
