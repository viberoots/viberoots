#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("auto-map: with a Go patch, only affected targets map provider", async () => {
  await runInTemp("auto-map-go-with-patch", async (tmp, $) => {
    // Create a Go patch for golang.org/x/net@v0.24.0
    const patchesDir = path.join(tmp, "patches/go");
    await fs.mkdir(patchesDir, { recursive: true });
    await fs.writeFile(
      path.join(patchesDir, "golang.org__x__net@v0.24.0.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );

    // Sync providers and emit provider index (bzl + json)
    await $`node tools/buck/sync-providers.ts --lang go --emit-index=true`;

    // Synthesize a graph with two nodes: one affected, one unrelated
    const graph = path.join(tmp, "tools/buck/graph.json");
    await fs.outputFile(
      graph,
      JSON.stringify([
        {
          name: "//apps/example:affected",
          rule_type: "go_binary",
          labels: ["module:golang.org/x/net@v0.24.0"],
        },
        {
          name: "//apps/example:unrelated",
          rule_type: "go_binary",
          labels: ["module:github.com/sirupsen/logrus@v1.9.0"],
        },
      ]),
      "utf8",
    );

    const out = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node tools/buck/gen-auto-map.ts --graph ${graph} --out ${out}`;
    const txt = await fs.readFile(out, "utf8");

    assert.match(
      txt,
      /"\/\/apps\/example:affected[^"]*":\s*\[\s*"\/\/third_party\/providers:mod_/m,
      "affected target should include a Go module provider",
    );
    assert.ok(
      !/"\/\/apps\/example:unrelated[^"]*":\s*\[\s*"\/\/third_party\/providers:mod_/m.test(txt),
      "unrelated target should not include a Go module provider",
    );
  });
});
