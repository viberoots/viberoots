#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: Go module labels are ignored (no provider mapping)", async () => {
  await runInTemp("auto-map-go-mod-ignored", async (tmp, $) => {
    // Synthesize a graph with a node labeled by a Go module
    const graphDir = path.join(tmp, "build-tools/tools/buck");
    await fsp.mkdir(graphDir, { recursive: true });
    const node = { name: "//app:bin", labels: ["module:golang.org/x/net@v0.24.0"] };
    await fsp.writeFile(path.join(graphDir, "graph.json"), JSON.stringify([node]), "utf8");

    // Generate auto_map
    const outPath = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out ${outPath}`;

    // Expect no Go module provider mapping present
    const data = await fsp.readFile(outPath, "utf8");
    if (/"\/\/app:bin[^"]*":\s*\[\s*"\/\/third_party\/providers:mod_/m.test(data)) {
      console.error("unexpected Go module provider mapping in auto_map");
      process.exit(2);
    }
  });
});
