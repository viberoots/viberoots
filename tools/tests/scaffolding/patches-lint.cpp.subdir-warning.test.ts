#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (cpp): subdirectory warns (non-strict) and fails (strict)", async () => {
  await runInTemp("patches-lint-cpp-subdir", async (tmp, $) => {
    const sub = path.join(tmp, "patches", "cpp", "bad");
    await fsp.mkdir(sub, { recursive: true });
    // Non-strict should warn but not fail
    const resWarn = await $({ nothrow: true })`node tools/dev/patches-lint.ts --lang cpp`;
    if (resWarn.exitCode !== 0) {
      console.error("expected non-strict lint to succeed despite subdir");
      process.exit(2);
    }
    // Strict should fail
    const resStrict = await $({
      nothrow: true,
    })`node tools/dev/patches-lint.ts --lang cpp --strict`;
    if (resStrict.exitCode === 0) {
      console.error("expected strict lint to fail due to subdir");
      process.exit(2);
    }
  });
});
