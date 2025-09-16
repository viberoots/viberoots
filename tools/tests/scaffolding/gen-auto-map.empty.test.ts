#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map: empty labels produces empty MODULE_PROVIDERS", async () => {
  await runInTemp("auto-map-empty", async (tmp, $) => {
    const graph = [];
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(graph),
      "utf8",
    );
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    const out = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "utf8",
    );
    if (!out.includes("MODULE_PROVIDERS = {")) {
      console.error("missing MODULE_PROVIDERS header");
      process.exit(2);
    }
    // Should be no entries
    if (out.includes("//:")) {
      console.error("expected no target entries for empty graph");
      process.exit(2);
    }
  });
});
