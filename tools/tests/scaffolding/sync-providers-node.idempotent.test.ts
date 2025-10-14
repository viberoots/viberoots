#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node: running twice is a no-op when inputs unchanged", async () => {
  await runInTemp("sync-node-idem", async (tmp, $) => {
    // Use the back-compat entry which delegates to the orchestrator's Node driver
    await $`node tools/buck/sync-providers-node.ts`;
    const outPath = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    const before = await fsp.readFile(outPath, "utf8");

    // Second run should not change the file contents
    await $`node tools/buck/sync-providers-node.ts`;
    const after = await fsp.readFile(outPath, "utf8");

    if (before !== after) {
      console.error("file changed on second run (should be no-op)");
      process.exit(2);
    }
  });
});
