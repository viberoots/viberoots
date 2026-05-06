#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

function withFrozenNow<T>(epochMs: number, fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => epochMs;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

test("verify-log-status: recent completion rate tracks now during later active passes", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=4 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/2 target_count=1 targets=//:a",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:a (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 target_count=3 targets=//:b //:c //:d",
    "[1970-01-01T00:03:30.000Z] ✓ Pass: root//:b (2.0s)",
    "[1970-01-01T00:03:45.000Z] ✓ Pass: root//:c (3.0s)",
  ].join("\n");

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 4, 0), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.done, false);
  assert.equal(st.pass, 3);
  assert.equal(st.completionRateRecentPerMinute, 1);
});

test("verify-log-status: projection waits until last pass has three minutes of signal", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=5 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=4",
    "[verify] target pass begin name=isolated index=1/2 start_s=100 target_count=1 targets=//:a",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:a (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 start_s=200 target_count=4 targets=//:b //:c //:d //:e",
    "[1970-01-01T00:03:50.000Z] ✓ Pass: root//:b (2.0s)",
    "[1970-01-01T00:05:50.000Z] ✓ Pass: root//:c (3.0s)",
  ].join("\n");

  const tooEarly = withFrozenNow(Date.UTC(1970, 0, 1, 0, 6, 19), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );
  assert.equal(tooEarly.projectedDuration, undefined);
  assert.equal(tooEarly.projectedEndTime, undefined);

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 6, 40), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.remaining, 2);
  assert.equal(st.completionRateRecentPerMinute, 2 / 3);
  assert.equal(st.projectedDuration, "8:00");
  assert.equal(
    st.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 9, 40)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});
