#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("gen-auto-map: Go module labels are ignored (no provider mapping)", async () => {
  await runInTemp("auto-map-go-mod-ignored", async (tmp, $) => {
    const fixtureRoot = path.join(tmp, "projects", "apps", "go-module-label-fixture");
    await fsp.mkdir(fixtureRoot, { recursive: true });
    await fsp.writeFile(
      path.join(fixtureRoot, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "filegroup")',
        "",
        "filegroup(",
        '    name = "bin",',
        '    labels = ["module:golang.org/x/net@v0.24.0"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);

    // Generate auto_map
    const outPath = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    await $({
      env: graphEnv,
    })`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out ${outPath}`;

    // Expect no Go module provider mapping present
    const data = await fsp.readFile(outPath, "utf8");
    if (
      /"\/\/projects\/apps\/go-module-label-fixture:bin[^"]*":\s*\[\s*"\/\/third_party\/providers:mod_/m.test(
        data,
      )
    ) {
      console.error("unexpected Go module provider mapping in auto_map");
      process.exit(2);
    }
  });
});
