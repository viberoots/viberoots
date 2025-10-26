#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard auto-fixes when stale and passes thereafter", async () => {
  await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // Initialize git so git-based checks in dev-build don't error out in temp repos
    await $`git init`;
    // Rely on runInTemp's default .buckconfig (no_cgo) instead of writing our own
    await $`scaf new go lib demo-lib --yes`;
    // Guard should auto-fix glue if stale and succeed
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
    // Build via Buck; platform is set by runInTemp's .buckconfig
    await $`buck2 build //...`;
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
  });
});
