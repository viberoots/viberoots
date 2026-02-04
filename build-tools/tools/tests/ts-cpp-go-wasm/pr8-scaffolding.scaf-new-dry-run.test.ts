#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr8: scaf new ts go-cpp-lib <name> supports dry-run", async () => {
  await runInTemp("pr8-scaf-new-dry-run", async (_tmp, $) => {
    const out =
      await $`node build-tools/tools/scaffolding/scaf.ts new ts go-cpp-lib demo --yes --dry-run`.nothrow();
    if (out.exitCode !== 0) {
      throw new Error("scaf new ts go-cpp-lib demo --dry-run failed");
    }
  });
});
