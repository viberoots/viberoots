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

test("verify-log-status: projection uses pass-group average rate before recent-rate maturity", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=14 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=13",
    "[verify] target pass begin name=isolated index=1/2 start_s=100 target_count=1 targets=//:a",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:a (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 start_s=200 target_count=13 targets=//:b //:c //:d //:e //:f //:g //:h //:i //:j //:k //:l //:m //:n",
    "[1970-01-01T00:03:50.000Z] ✓ Pass: root//:b (2.0s)",
    "[1970-01-01T00:03:55.000Z] ✓ Pass: root//:c (3.0s)",
    "[1970-01-01T00:04:00.000Z] ✓ Pass: root//:d (3.0s)",
    "[1970-01-01T00:04:05.000Z] ✓ Pass: root//:e (3.0s)",
    "[1970-01-01T00:04:10.000Z] ✓ Pass: root//:f (3.0s)",
    "[1970-01-01T00:04:15.000Z] ✓ Pass: root//:g (3.0s)",
    "[1970-01-01T00:04:20.000Z] ✓ Pass: root//:h (3.0s)",
    "[1970-01-01T00:04:25.000Z] ✓ Pass: root//:i (3.0s)",
    "[1970-01-01T00:04:30.000Z] ✓ Pass: root//:j (3.0s)",
    "[1970-01-01T00:04:35.000Z] ✓ Pass: root//:k (3.0s)",
    "[1970-01-01T00:04:40.000Z] ✓ Pass: root//:l (3.0s)",
    "[1970-01-01T00:04:45.000Z] ✓ Pass: root//:m (3.0s)",
  ].join("\n");

  const tooEarly = withFrozenNow(Date.UTC(1970, 0, 1, 0, 6, 19), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );
  assert.equal(tooEarly.projectedDuration, "4:53");
  assert.equal(
    tooEarly.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 6, 33.916666666666664)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 6, 40), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.remaining, 1);
  assert.equal(st.completionRateRecentPerMinute, 4);
  assert.equal(st.projectedDuration, "5:16");
  assert.equal(
    st.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 6, 56.666666666666664)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});

test("verify-log-status: projection waits until every pass group has begun", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=6 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=2 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/3 start_s=100 target_count=1 targets=//:iso",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=shared index=3/3 start_s=200 target_count=3 targets=//:shared-a //:shared-b //:shared-c",
    "[1970-01-01T00:04:30.000Z] ✓ Pass: root//:shared-a (1.0s)",
    "[1970-01-01T00:05:00.000Z] ✓ Pass: root//:shared-b (1.0s)",
  ].join("\n");

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 6, 40), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.passName, "shared");
  assert.equal(st.passIndex, 3);
  assert.equal(st.passTotal, 3);
  assert.equal(st.projectedDuration, undefined);
  assert.equal(st.projectedEndTime, undefined);
});

test("verify-log-status: overlapping pass projection starts once every active lane has average-rate signal", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=16 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=5 shared_targets=10",
    "[verify] target pass begin name=isolated index=1/3 start_s=100 target_count=1 targets=//:iso",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=shared index=3/3 start_s=200 target_count=10 targets=//:shared-a //:shared-b //:shared-c //:shared-d //:shared-e //:shared-f //:shared-g //:shared-h //:shared-i //:shared-j",
    "[verify] target pass begin name=resource-limited index=2/3 start_s=300 target_count=5 targets=//:resource-a //:resource-b //:resource-c //:resource-d //:resource-e",
    "[1970-01-01T00:07:30.000Z] ✓ Pass: root//:shared-a (1.0s)",
    "[1970-01-01T00:08:00.000Z] ✓ Pass: root//:shared-b (1.0s)",
    "[1970-01-01T00:08:30.000Z] ✓ Pass: root//:shared-c (1.0s)",
    "[1970-01-01T00:09:00.000Z] ✓ Pass: root//:shared-d (1.0s)",
    "[1970-01-01T00:09:30.000Z] ✓ Pass: root//:resource-a (2.0s)",
  ].join("\n");

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 10, 0), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.passName, "resource-limited");
  assert.equal(st.passIndex, 2);
  assert.equal(st.passTotal, 3);
  assert.equal(st.projectedDuration, "28:20");
  assert.equal(
    st.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 30, 0)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});

test("verify-log-status: overlapping pass projection uses slowest mature active lane", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=53 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=26 shared_targets=26",
    "[verify] target pass begin name=isolated index=1/3 start_s=100 target_count=1 targets=//:iso",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=shared index=3/3 start_s=200 target_count=26 targets=//:shared-a //:shared-b //:shared-c //:shared-d //:shared-e //:shared-f //:shared-g //:shared-h //:shared-i //:shared-j //:shared-k //:shared-l //:shared-m //:shared-n //:shared-o //:shared-p //:shared-q //:shared-r //:shared-s //:shared-t //:shared-u //:shared-v //:shared-w //:shared-x //:shared-y //:shared-z",
    "[verify] target pass begin name=resource-limited index=2/3 start_s=300 target_count=26 targets=//:resource-a //:resource-b //:resource-c //:resource-d //:resource-e //:resource-f //:resource-g //:resource-h //:resource-i //:resource-j //:resource-k //:resource-l //:resource-m //:resource-n //:resource-o //:resource-p //:resource-q //:resource-r //:resource-s //:resource-t //:resource-u //:resource-v //:resource-w //:resource-x //:resource-y //:resource-z",
    "[1970-01-01T00:07:30.000Z] ✓ Pass: root//:shared-a (1.0s)",
    "[1970-01-01T00:08:00.000Z] ✓ Pass: root//:shared-b (1.0s)",
    "[1970-01-01T00:08:30.000Z] ✓ Pass: root//:shared-c (1.0s)",
    "[1970-01-01T00:09:00.000Z] ✓ Pass: root//:shared-d (1.0s)",
    "[1970-01-01T00:08:00.000Z] ✓ Pass: root//:shared-e (1.0s)",
    "[1970-01-01T00:08:05.000Z] ✓ Pass: root//:shared-f (1.0s)",
    "[1970-01-01T00:08:10.000Z] ✓ Pass: root//:shared-g (1.0s)",
    "[1970-01-01T00:08:15.000Z] ✓ Pass: root//:shared-h (1.0s)",
    "[1970-01-01T00:08:20.000Z] ✓ Pass: root//:shared-i (1.0s)",
    "[1970-01-01T00:08:25.000Z] ✓ Pass: root//:shared-j (1.0s)",
    "[1970-01-01T00:08:30.000Z] ✓ Pass: root//:shared-k (1.0s)",
    "[1970-01-01T00:08:35.000Z] ✓ Pass: root//:shared-l (1.0s)",
    "[1970-01-01T00:08:40.000Z] ✓ Pass: root//:shared-m (1.0s)",
    "[1970-01-01T00:08:45.000Z] ✓ Pass: root//:shared-n (1.0s)",
    "[1970-01-01T00:09:00.000Z] ✓ Pass: root//:resource-a (2.0s)",
    "[1970-01-01T00:09:05.000Z] ✓ Pass: root//:resource-b (2.0s)",
    "[1970-01-01T00:09:10.000Z] ✓ Pass: root//:resource-c (2.0s)",
    "[1970-01-01T00:09:15.000Z] ✓ Pass: root//:resource-d (2.0s)",
    "[1970-01-01T00:09:20.000Z] ✓ Pass: root//:resource-e (2.0s)",
    "[1970-01-01T00:09:25.000Z] ✓ Pass: root//:resource-f (2.0s)",
    "[1970-01-01T00:09:30.000Z] ✓ Pass: root//:resource-g (2.0s)",
    "[1970-01-01T00:09:35.000Z] ✓ Pass: root//:resource-h (2.0s)",
    "[1970-01-01T00:09:40.000Z] ✓ Pass: root//:resource-i (2.0s)",
    "[1970-01-01T00:09:45.000Z] ✓ Pass: root//:resource-j (2.0s)",
    "[1970-01-01T00:09:50.000Z] ✓ Pass: root//:resource-k (2.0s)",
    "[1970-01-01T00:09:55.000Z] ✓ Pass: root//:resource-l (2.0s)",
  ].join("\n");

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 10, 0), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.passName, "resource-limited");
  assert.equal(st.passIndex, 2);
  assert.equal(st.passTotal, 3);
  assert.equal(st.remaining, 26);
  assert.equal(st.completionRateRecentPerMinute, 26 / 3);
  assert.equal(st.projectedDuration, "14:10");
  assert.equal(
    st.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 15, 50)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});

test("verify-log-status: projection follows delayed resource-limited lane after shared exits", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=9 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=5 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/3 start_s=100 target_count=1 targets=//:iso",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass group staged start delay_s=900 immediate=shared delayed=resource-limited",
    "[verify] target pass begin name=shared index=3/3 start_s=200 target_count=3 targets=//:shared-a //:shared-b //:shared-c",
    "[verify] target pass begin name=resource-limited index=2/3 start_s=300 target_count=5 targets=//:resource-a //:resource-b //:resource-c //:resource-d //:resource-e",
    "[1970-01-01T00:05:30.000Z] ✓ Pass: root//:shared-a (1.0s)",
    "[1970-01-01T00:05:45.000Z] ✓ Pass: root//:shared-b (1.0s)",
    "[1970-01-01T00:06:00.000Z] ✓ Pass: root//:shared-c (1.0s)",
    "[verify] buck2 test exit iso=v-123-shared pass=shared status=0 end_s=400 duration_s=200 pass_count=3 fail_count=0 completions=3 threads=8",
    "[verify] target pass end name=shared index=3/3 status=0",
    "[1970-01-01T00:08:20.000Z] ✓ Pass: root//:resource-a (2.0s)",
    "[1970-01-01T00:09:10.000Z] ✓ Pass: root//:resource-b (2.0s)",
  ].join("\n");

  const st = withFrozenNow(Date.UTC(1970, 0, 1, 0, 10, 0), () =>
    computeVerifyStatusFromLogText({
      logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
      pid: 123,
      text: log,
    }),
  );

  assert.equal(st.passName, "resource-limited");
  assert.equal(st.passIndex, 2);
  assert.equal(st.passTotal, 3);
  assert.equal(st.remaining, 3);
  assert.equal(st.projectedDuration, "15:50");
  assert.equal(
    st.projectedEndTime,
    new Date(Date.UTC(1970, 0, 1, 0, 17, 30)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
});
