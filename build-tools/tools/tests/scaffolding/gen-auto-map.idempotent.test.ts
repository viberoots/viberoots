#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: second run is a no-op when graph unchanged", async () => {
  await runInTemp("auto-map-idem", async (tmp, $) => {
    const nodes = [{ name: "//lib:core", labels: ["module:example.com/x/y@v0.1.0"] }];
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
      JSON.stringify(nodes),
      "utf8",
    );
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    const before = await fsp.readFile(
      path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl"),
      "utf8",
    );
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
    const after = await fsp.readFile(
      path.join(tmp, ".viberoots", "workspace", "providers", "auto_map.bzl"),
      "utf8",
    );
    if (before !== after) {
      console.error("auto_map.bzl changed on second run (should be no-op)");
      process.exit(2);
    }
  });
});
