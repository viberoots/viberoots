#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Go related module labels do not map to providers (Node-only)", async () => {
  await runInTemp("minimal-invalidation-related", async (tmp, $) => {
    const graphPath = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const outPath = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.mkdirp(path.dirname(outPath));

    const target = "//service:bin";
    const related = "golang.org/x/net@v0.24.0";
    const nodes = [
      { name: target, rule_type: "go_binary", labels: ["lang:go", `module:${related}`] },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes, null, 2), "utf8");

    await $({
      cwd: tmp,
    })`viberoots/build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const data = await fs.readFile(outPath, "utf8");
    if (data.includes("//third_party/providers:mod_")) {
      console.error("did not expect Go module provider mapping after related change", data);
      process.exit(2);
    }
  });
});
