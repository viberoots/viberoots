#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node: running twice is a no-op when inputs unchanged", async () => {
  await runInTemp("sync-node-idem", async (tmp, $) => {
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, providerAutoTargetsPath("node"));
    const before = await fsp.readFile(outPath, "utf8");

    // Second run should not change the file contents
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const after = await fsp.readFile(outPath, "utf8");

    if (before !== after) {
      console.error("file changed on second run (should be no-op)");
      process.exit(2);
    }
  });
});
