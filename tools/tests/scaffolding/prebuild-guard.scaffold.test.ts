#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard fails before glue and passes after", async () => {
  await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes`;
    // First run prebuild-guard explicitly: expect failure
    let failed = false;
    try {
      await $`node tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected prebuild-guard to fail before glue");
      process.exit(2);
    }
    // After glue via build, guard should pass
    await $`build`;
    await $`node tools/buck/prebuild-guard.ts`;
  });
});
