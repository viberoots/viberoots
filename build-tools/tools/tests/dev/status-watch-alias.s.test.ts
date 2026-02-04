#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("s: forwards to tail-log --status -w (help path)", async () => {
  const res = await $`${process.cwd()}/build-tools/tools/bin/s --help`.nothrow();
  // tail-log exits 2 for help, prints usage to stderr.
  assert.equal(res.exitCode, 2);
  assert.match(res.stderr, /tail-log/i);
  assert.match(res.stderr, /--status/i);
  assert.match(res.stderr, /--watch|-w/i);
});
