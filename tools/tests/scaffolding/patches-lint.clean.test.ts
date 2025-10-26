#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: clean repo emits no warnings (non-strict)", async () => {
  await runInTemp("patches-lint-clean", async (tmp, $) => {
    await $`zx-wrapper tools/dev/patches-lint.ts`;
  });
});
