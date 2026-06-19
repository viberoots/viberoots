#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("auto-map: Go module labels do not map to providers (even with local patches)", async () => {
  await runInTemp("auto-map-go-with-patch", async (tmp, $) => {
    // Create a Go patch for golang.org/x/net@v0.24.0 under local patches
    const patchesDir = path.join(tmp, "patches/go");
    await fs.mkdir(patchesDir, { recursive: true });
    await fs.writeFile(
      path.join(patchesDir, "golang.org__x__net@v0.24.0.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );

    // Synthesize a graph with two nodes: one labeled by the module, one unrelated
    const graph = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.outputFile(
      graph,
      JSON.stringify([
        {
          name: "//projects/apps/example:affected",
          rule_type: "go_binary",
          labels: ["module:golang.org/x/net@v0.24.0"],
        },
        {
          name: "//projects/apps/example:unrelated",
          rule_type: "go_binary",
          labels: ["module:github.com/sirupsen/logrus@v1.9.0"],
        },
      ]),
      "utf8",
    );

    const out = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph ${graph} --out ${out}`;
    const txt = await fs.readFile(out, "utf8");

    assert.ok(!/:mod_/m.test(txt), "no Go module providers should be mapped");
  });
});
