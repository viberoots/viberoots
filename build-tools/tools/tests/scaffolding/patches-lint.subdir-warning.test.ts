#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: subdirectory warns (non-strict) and fails (strict)", async () => {
  await runInTemp("patches-lint-subdir", async (tmp, $) => {
    const sub = path.join(tmp, "patches", "go", "foo");
    await fsp.mkdir(sub, { recursive: true });
    await $`node build-tools/tools/dev/patches-lint.ts`;
    let failed = false;
    try {
      await $({ stdio: "pipe" })`node build-tools/tools/dev/patches-lint.ts --strict`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected strict lint to fail due to subdir");
      process.exit(2);
    }
  });
});
