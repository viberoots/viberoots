#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("export-graph writes tools/buck/graph.json and parses", async () => {
  await runInTemp("export-graph", async (tmp, $) => {
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const p = path.join(tmp, "tools", "buck", "graph.json");
    const txt = await fsp.readFile(p, "utf8");
    const nodes = JSON.parse(txt);
    if (!Array.isArray(nodes)) {
      console.error("expected nodes array in graph.json");
      process.exit(2);
    }
  });
});
