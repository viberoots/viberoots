#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("kill-all: --dry-run exits 0", async () => {
  const res = await $`${process.cwd()}/tools/bin/kill-all --dry-run`.nothrow();
  assert.equal(res.exitCode, 0);
});
