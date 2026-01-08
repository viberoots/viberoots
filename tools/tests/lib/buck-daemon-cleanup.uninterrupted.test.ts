#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("buck cleanup: uninterrupted runInTemp does not leave buck2 daemons behind", async () => {
  // If runInTemp fails to terminate buck2 daemons before deleting the temp repo,
  // it now throws from its cleanup block and this test will fail.
  await runInTemp("buck-cleanup-uninterrupted", async (_tmp, $) => {
    await $`buck2 build //:flake.lock`;
  });
});
