#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "../scaffolding/lib/viberoots-tools";

test("scaf new ts go-cpp-lib <name> supports dry-run", async () => {
  await runInTemp("scaf-new-dry-run", async (_tmp, $) => {
    const out =
      await $`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} new ts go-cpp-lib demo --yes --dry-run`.nothrow();
    if (out.exitCode !== 0) {
      throw new Error("scaf new ts go-cpp-lib demo --dry-run failed");
    }
  });
});
