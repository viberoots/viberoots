#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: prefers final summary when present (verify window, after exit marker)", () => {
  const log = [
    "[verify] buck2 test begin iso=v-1 start_s=100",
    "\u001b[1GCommand: test. Time elapsed: 1:02.3s\u001b[K",
    "Some noise",
    "Tests finished: Pass 581. Fail 0. Fatal 0. Skip 0. Build failure 0",
    "[verify] buck2 test exit iso=v-1 status=0 end_s=162",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, true);
  assert.equal(st.source, "summary");
  assert.equal(st.pass, 581);
  assert.equal(st.fail, 0);
  assert.equal(st.fatal, 0);
  assert.equal(st.skip, 0);
  assert.equal(st.buildFailure, 0);
  assert.equal(st.elapsed, "1:02.3s");
});

test("verify-log-status: ignores comment-prefixed 'Tests finished' lines", () => {
  const log = [
    "[2025-12-26T14:35:06.370-08:00] # Tests finished: Pass 1. Fail 0. Fatal 0. Skip 0. Build failure 0",
    "[2025-12-26T14:35:06.371-08:00] ✓ Pass: root//:a (1.0s)",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, false);
  assert.equal(st.pass, 1);
});

test("verify-log-status: does not treat action-level 'Tests finished' as done while verify is running", () => {
  const log = [
    "[verify] buck2 test begin iso=v-1 start_s=100",
    // A per-action summary line can appear while other tests are still running.
    "Tests finished: Pass 0. Fail 1. Fatal 0. Skip 0. Build failure 0",
    "Waiting on Test foo --  [local_execute], and 3 other actions",
    "Waiting on Test bar --  [local_execute], and 2 other actions",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.source, "derived");
  assert.equal(st.done, false);
  assert.ok((st.remaining ?? 0) > 0);
});
