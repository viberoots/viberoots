#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeVerifyStatusFromLogText,
  formatVerifyStatusJsonLine,
  formatVerifyStatusText,
} from "../../lib/verify-log-status.ts";

test("verify-log-status: stopped historical logs freeze elapsed instead of ticking", () => {
  const saved = Date.now;
  try {
    (Date as any).now = () => 999_999_999_000;
    const log = [
      "[verify] begin iso=v-1 start_s=100",
      "[verify] target pass begin name=shared index=1/1 target_count=2 targets=//:a //:b",
      "✓ Pass: root//:a (1.0s)",
      "Remaining: 1",
    ].join("\n");

    const st = computeVerifyStatusFromLogText({
      logPath: "/tmp/x.log",
      pid: 1,
      text: log,
      stoppedAtSec: 160,
      stopReason: "process-exited",
    });

    assert.equal(st.done, false);
    assert.equal(st.stopped, true);
    assert.equal(st.stopReason, "process-exited");
    assert.equal(st.elapsed, "1:00");
    assert.equal(st.remaining, 1);

    const text = formatVerifyStatusText(st, { isTty: false });
    assert.match(text, /\nTests stopped:\n/);
    assert.match(text, /\nRun stopped:\s+process-exited\n/);

    const json = JSON.parse(formatVerifyStatusJsonLine(st));
    assert.equal(json.done, false);
    assert.equal(json.stopped, true);
    assert.equal(json.stop_reason, "process-exited");
  } finally {
    (Date as any).now = saved;
  }
});

test("verify-log-status: explicit stopped marker freezes elapsed", () => {
  const saved = Date.now;
  try {
    (Date as any).now = () => 999_999_999_000;
    const log = [
      "[verify] begin iso=v-1 start_s=100",
      "[verify] target pass begin name=shared index=1/1 target_count=1 targets=//:a",
      "[verify] stopped signal=SIGINT end_s=190",
    ].join("\n");

    const st = computeVerifyStatusFromLogText({
      logPath: "/tmp/x.log",
      pid: 1,
      text: log,
    });

    assert.equal(st.done, false);
    assert.equal(st.stopped, true);
    assert.equal(st.stopReason, "signal:SIGINT");
    assert.equal(st.elapsed, "1:30");
  } finally {
    (Date as any).now = saved;
  }
});

test("verify-log-status: exit marker wins over stale stopped-at fallback", () => {
  const log = [
    "[verify] begin iso=v-1 start_s=100",
    "[verify] target pass begin name=shared index=1/1 target_count=1 targets=//:a",
    "[verify] buck2 test exit iso=v-1 pass=shared status=0 end_s=160 duration_s=60 pass_count=1 fail_count=0 completions=1 threads=8",
    "[verify] target pass end name=shared index=1/1 status=0",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/tmp/x.log",
    pid: 1,
    text: log,
    stoppedAtSec: 200,
  });

  assert.equal(st.done, true);
  assert.equal(st.stopped, false);
  assert.equal(st.elapsed, "1:00");
});
