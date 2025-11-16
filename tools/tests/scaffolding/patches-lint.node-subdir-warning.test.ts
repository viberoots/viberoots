#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (node): subdirectory warns (non-strict) and fails (strict)", async () => {
  await runInTemp("patches-lint-node-subdir", async (tmp, $) => {
    const sub = path.join(tmp, "patches", "node", "foo");
    await fsp.mkdir(sub, { recursive: true });
    await $`node tools/dev/patches-lint.ts --lang node`;
    let failed = false;
    try {
      await $({ stdio: "pipe" })`node tools/dev/patches-lint.ts --lang node --strict`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected strict lint to fail due to subdir (node)");
      process.exit(2);
    }
  });
});
