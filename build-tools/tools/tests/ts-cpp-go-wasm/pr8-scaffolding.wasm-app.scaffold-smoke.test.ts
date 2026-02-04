#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr8: scaffold ts wasm-app (smoke)", async () => {
  await runInTemp("pr8-ts-wasm-app", async (_tmp, $) => {
    // Just ensure the template can scaffold without errors in a temp repo
    const out =
      await $`node build-tools/tools/scaffolding/scaf.ts new ts wasm-app webdemo --yes --dry-run`.nothrow();
    if (out.exitCode !== 0) {
      throw new Error("scaf new ts wasm-app webdemo --dry-run failed");
    }
  });
});
