#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("tail-log status watch: piping JSON output does not crash on EPIPE", async () => {
  // `build-tools/tools/bin/s` defaults to watch mode; piping to `head` closes stdout and used to crash with EPIPE.
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`bash --noprofile --norc -c 'timeout -k 1s 10s build-tools/tools/bin/s --json | head -n 1 >/dev/null'`;
  // Head closing stdout should not make the process fail.
  assert.equal(res.exitCode, 0);
});
