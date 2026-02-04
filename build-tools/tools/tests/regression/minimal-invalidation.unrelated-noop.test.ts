#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("unrelated patch change does not alter provider mapping for target", async () => {
  await runInTemp("minimal-invalidation-unrelated", async (tmp, $) => {
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    const outPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.mkdirp(path.dirname(outPath));

    const target = "//service:bin";
    const related = "golang.org/x/net@v0.24.0";
    const unrelated = "github.com/sirupsen/logrus@v1.9.0";
    const nodes = [
      { name: target, rule_type: "go_binary", labels: ["lang:go", `module:${related}`] },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes, null, 2), "utf8");

    await $({
      cwd: tmp,
    })`build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const before = await fs.readFile(outPath, "utf8");

    // Touch an unrelated patch path and re-run generator; since gen-auto-map is graph-driven, mapping should be unchanged
    await fs.mkdirp(path.join(tmp, "patches/go"));
    await fs.writeFile(
      path.join(tmp, "patches/go", "github.com__sirupsen__logrus@v1.9.0.patch"),
      "# noop\n",
      "utf8",
    );

    await $({
      cwd: tmp,
    })`build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const after = await fs.readFile(outPath, "utf8");

    if (before !== after) {
      console.error("provider mapping changed unexpectedly for unrelated patch change");
      process.exit(2);
    }
  });
});
