#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("rsync: excludes test-logs by default", async () => {
  await runInTemp("rsync-excludes-test-logs", async (tmp, $) => {
    const p = path.join(tmp, "test-logs");
    let exists = true;
    try {
      await fsp.access(p);
    } catch {
      exists = false;
    }
    if (exists) {
      console.error("expected test-logs to be excluded from temp copy, but it exists:", p);
      process.exit(2);
    }
  });
});
