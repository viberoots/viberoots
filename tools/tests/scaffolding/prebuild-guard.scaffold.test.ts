#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard auto-fixes when stale and passes thereafter", async () => {
  await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes`;
    // Guard should auto-fix glue if stale and succeed
    await $`node tools/buck/prebuild-guard.ts`;
    // Build also succeeds and guard remains satisfied
    await $`build`;
    await $`node tools/buck/prebuild-guard.ts`;
  });
});
