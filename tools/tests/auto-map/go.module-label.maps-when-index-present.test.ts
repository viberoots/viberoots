#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForModuleKey } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: Go module labels map to providers when provider index is present", async () => {
  await runInTemp("auto-map-go-mod-with-index", async (tmp, $) => {
    // Create a Go patch so provider sync emits a Go provider and provider_index files
    const goPatchDir = path.join(tmp, "patches/go");
    await fsp.mkdir(goPatchDir, { recursive: true });
    await fsp.writeFile(
      path.join(goPatchDir, "golang.org__x__net@v0.24.0.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );

    // Emit provider files and provider_index
    await $`node tools/buck/sync-providers.ts --lang go --emit-index=true`;

    // Synthesize a graph with a node labeled by that Go module
    const graphDir = path.join(tmp, "tools/buck");
    await fsp.mkdir(graphDir, { recursive: true });
    const node = { name: "//app:bin", labels: ["module:golang.org/x/net@v0.24.0"] };
    await fsp.writeFile(path.join(graphDir, "graph.json"), JSON.stringify([node]), "utf8");

    // Generate auto_map
    const outPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out ${outPath}`;

    // Expect the mapped provider label to be present for //app:bin
    const expected = `//third_party/providers:${providerNameForModuleKey(
      "golang.org/x/net",
      "v0.24.0",
    )}`;
    const data = await fsp.readFile(outPath, "utf8");
    if (!data.includes('"//app:bin": [')) {
      console.error("missing target entry for //app:bin in auto_map");
      process.exit(2);
    }
    if (!data.includes(expected)) {
      console.error("missing expected Go module provider mapping in auto_map");
      console.error("expected:", expected);
      process.exit(2);
    }
  });
});
