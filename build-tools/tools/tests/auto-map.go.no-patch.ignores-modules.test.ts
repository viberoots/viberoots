#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("auto-map: with no Go patches, module: labels are ignored", async () => {
  await runInTemp("auto-map-go-no-patch", async (tmp, $) => {
    // Synthesize a tiny graph with a module label that would map if a provider existed
    const graph = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.outputFile(
      graph,
      JSON.stringify([
        {
          name: "//projects/apps/example:bin",
          rule_type: "go_binary",
          labels: ["module:golang.org/x/net@v0.24.0"],
        },
      ]),
      "utf8",
    );

    const out = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graph} --out ${out}`;
    const txt = await fs.readFile(out, "utf8");
    assert.ok(
      !/third_party\/providers:mod_/i.test(txt),
      "should not include any Go module providers",
    );
  });
});
