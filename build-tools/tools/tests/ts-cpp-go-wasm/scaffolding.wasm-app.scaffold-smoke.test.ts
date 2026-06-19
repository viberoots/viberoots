#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "../scaffolding/lib/viberoots-tools";

test("scaffold ts wasm-app (smoke)", async () => {
  await runInTemp("ts-wasm-app", async (_tmp, $) => {
    // Just ensure the template can scaffold without errors in a temp repo
    const out =
      await $`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} new ts wasm-app webdemo --yes --dry-run`.nothrow();
    if (out.exitCode !== 0) {
      throw new Error("scaf new ts wasm-app webdemo --dry-run failed");
    }
  });
});
