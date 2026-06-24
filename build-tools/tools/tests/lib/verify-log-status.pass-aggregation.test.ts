#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeVerifyStatusFromLogText,
  formatVerifyStatusJsonLine,
  formatVerifyStatusText,
} from "../../lib/verify-log-status";

test("verify-log-status: aggregates completed pass counts with current pass progress", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=3 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=2",
    "[verify] target pass begin name=isolated index=1/2 target_count=1 targets=//:a",
    "✓ Pass: root//:a (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 target_count=2 targets=//:b //:c",
    "✓ Pass: root//:b (2.0s)",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, false);
  assert.equal(st.pass, 2);
  assert.equal(st.fail, 0);
  assert.equal(st.passName, "shared");
  assert.equal(st.passIndex, 2);
  assert.equal(st.passTotal, 2);
  assert.equal(st.groupCompleted, 1);
  assert.equal(st.groupTotal, 2);
  assert.deepEqual(
    st.passGroups?.map((group) => ({
      name: group.name,
      completed: group.completed,
      targetCount: group.targetCount,
      done: group.done,
      active: group.active,
    })),
    [
      { name: "isolated", completed: 1, targetCount: 1, done: true, active: false },
      { name: "shared", completed: 1, targetCount: 2, done: false, active: true },
    ],
  );
  assert.equal(st.remaining, 1);
  assert.equal(st.source, "derived");

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(out, /Tests:\s+\[█████████████████████░░░░░░░░░░░\] 2\/3/);
  assert.doesNotMatch(out, /Pass group:/);
  assert.match(
    out,
    /Pass groups:\n\s+isolated  1\/1  done\s+\? avg\n\s+shared    1\/2  active\s+\? avg/,
  );
  assert.match(out, /\n  Pass:\s+2\n/);
});

test("verify-log-status: pass group rows show completed outcomes over target count", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=4 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/2 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 target_count=3 targets=//:a //:b //:c",
    "✓ Pass: root//:a (1.0s)",
    "✗ Fail: root//:b (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=shared status=32 end_s=120 duration_s=20 pass_count=1 fail_count=1 completions=2 threads=8",
    "[verify] target pass end name=shared index=2/2 status=32",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(
    out,
    /Pass groups:\n\s+isolated  1\/1  done\s+\? avg\n\s+shared    3\/3  failed\s+\? avg/,
  );
  assert.match(out, /\nTests finished:\n  Pass:\s+2\n  Fail:\s+1\n/);
});

test("verify-log-status: timeout pass group rows preserve partial completion count", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=4 pass_count=2 isolated_passes=1 isolated_targets=1 resource_limited_targets=3",
    "[verify] target pass begin name=isolated index=1/2 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=resource-limited index=2/2 target_count=3 targets=//:a //:b //:c",
    "✓ Pass: root//:a (1.0s)",
    "✗ Fail: root//:b (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=resource-limited status=124 end_s=120 duration_s=20 pass_count=1 fail_count=1 completions=2 threads=2",
    "[verify] target pass end name=resource-limited index=2/2 status=124",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(
    out,
    /Pass groups:\n\s+isolated          1\/1  done\s+\? avg\n\s+resource-limited  2\/3  failed\s+\? avg/,
  );
  assert.match(out, /\nTests stopped:\n  Pass:\s+2\n  Fail:\s+1\n/);
  assert.match(out, /\n  Build failure:\s+1\n/);
  assert.match(out, /\nTests remaining:\s+1\n/);
});

test("verify-log-status: final multi-pass status uses aggregate pass exit counts", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=3 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=2",
    "[verify] target pass begin name=isolated index=1/2 target_count=1 targets=//:a",
    "[1970-01-01T00:01:45.000Z] ✓ Pass: root//:a (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 target_count=2 targets=//:b //:c",
    "[1970-01-01T00:02:05.000Z] ✓ Pass: root//:b (2.0s)",
    "[1970-01-01T00:02:10.000Z] ✓ Pass: root//:c (3.0s)",
    "[verify] buck2 test exit iso=v-123 pass=shared status=0 end_s=130 duration_s=20 pass_count=2 fail_count=0 completions=2 threads=8",
    "[verify] target pass end name=shared index=2/2 status=0",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, true);
  assert.equal(st.pass, 3);
  assert.equal(st.fail, 0);
  assert.equal(st.remaining, 0);
  assert.equal(st.passName, "shared");
  assert.equal(st.passIndex, 2);
  assert.equal(st.passTotal, 2);
  assert.equal(st.groupCompleted, 2);
  assert.equal(st.groupTotal, 2);
  assert.equal(st.completionRateAvgPerMinute, 6);
  assert.equal(st.completionRateRecentPerMinute, 1);
});

test("verify-log-status: uses expanded target count before later passes begin", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=4 pass_count=2 isolated_passes=1 isolated_targets=2 shared_targets=2",
    "[verify] target pass begin name=isolated index=1/2 targets=//:a //:b",
    "✓ Pass: root//:a (1.0s)",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.pass, 1);
  assert.equal(st.remaining, 3);
});

test("verify-log-status: aggregates overlapping in-progress passes without resetting remaining", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=6 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=2 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/3 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=resource-limited index=2/3 target_count=2 targets=//:resource-a //:resource-b",
    "✓ Pass: root//:resource-a (2.0s)",
    "[verify] target pass begin name=shared index=3/3 target_count=3 targets=//:shared-a //:shared-b //:shared-c",
    "✓ Pass: root//:shared-a (1.0s)",
    "✓ Pass: root//:shared-b (1.0s)",
    "Remaining: 1",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, false);
  assert.equal(st.pass, 4);
  assert.equal(st.remaining, 2);
  assert.equal(st.passName, "shared");
  assert.equal(st.passIndex, 3);
  assert.equal(st.passTotal, 3);
  assert.equal(st.groupCompleted, 2);
  assert.equal(st.groupTotal, 3);
  assert.deepEqual(
    JSON.parse(formatVerifyStatusJsonLine(st)).pass_groups.map(
      (group: Record<string, unknown>) => ({
        name: group.name,
        completed: group.completed,
        target_count: group.target_count,
        done: group.done,
        active: group.active,
      }),
    ),
    [
      { name: "isolated", completed: 1, target_count: 1, done: true, active: false },
      {
        name: "resource-limited",
        completed: 1,
        target_count: 2,
        done: false,
        active: true,
      },
      { name: "shared", completed: 2, target_count: 3, done: false, active: true },
    ],
  );
  assert.deepEqual(
    st.passGroups?.map((group) => ({
      name: group.name,
      completed: group.completed,
      targetCount: group.targetCount,
      done: group.done,
      active: group.active,
    })),
    [
      { name: "isolated", completed: 1, targetCount: 1, done: true, active: false },
      {
        name: "resource-limited",
        completed: 1,
        targetCount: 2,
        done: false,
        active: true,
      },
      { name: "shared", completed: 2, targetCount: 3, done: false, active: true },
    ],
  );
});

test("verify-log-status: does not double-count overlapped pass output after one pass exits", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=6 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=2 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/3 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=resource-limited index=2/3 target_count=2 targets=//:resource-a //:resource-b",
    "✓ Pass: root//:resource-a (2.0s)",
    "[verify] target pass begin name=shared index=3/3 target_count=3 targets=//:shared-a //:shared-b //:shared-c",
    "✓ Pass: root//:shared-a (1.0s)",
    "✓ Pass: root//:shared-b (1.0s)",
    "✓ Pass: root//:shared-c (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=shared status=0 end_s=130 duration_s=20 pass_count=3 fail_count=0 completions=3 threads=8",
    "[verify] target pass end name=shared index=3/3 status=0",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, false);
  assert.equal(st.pass, 5);
  assert.equal(st.remaining, 1);
});

test("verify-log-status: marks out-of-order pass groups done after every group exits", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=6 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=2 shared_targets=3",
    "[verify] target pass begin name=isolated index=1/3 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=resource-limited index=2/3 target_count=2 targets=//:resource-a //:resource-b",
    "✓ Pass: root//:resource-a (2.0s)",
    "[verify] target pass begin name=shared index=3/3 target_count=3 targets=//:shared-a //:shared-b //:shared-c",
    "✓ Pass: root//:shared-a (1.0s)",
    "✓ Pass: root//:shared-b (1.0s)",
    "✓ Pass: root//:shared-c (1.0s)",
    "[verify] buck2 test exit iso=v-123 pass=shared status=0 end_s=130 duration_s=20 pass_count=3 fail_count=0 completions=3 threads=8",
    "[verify] target pass end name=shared index=3/3 status=0",
    "✓ Pass: root//:resource-b (2.0s)",
    "[verify] buck2 test exit iso=v-123 pass=resource-limited status=0 end_s=140 duration_s=30 pass_count=2 fail_count=0 completions=2 threads=4",
    "[verify] target pass end name=resource-limited index=2/3 status=0",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, true);
  assert.equal(st.pass, 6);
  assert.equal(st.remaining, 0);
});

test("verify-log-status: final multi-pass failed list includes failures from every pass", () => {
  const log = [
    "[verify] begin iso=v-123 start_s=100",
    "[verify] expanded targets: concrete=5 pass_count=3 isolated_passes=1 isolated_targets=1 resource_limited_targets=2 shared_targets=2",
    "[verify] target pass begin name=isolated index=1/3 target_count=1 targets=//:iso",
    "✓ Pass: root//:iso (0.5s)",
    "[verify] buck2 test exit iso=v-123 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=isolated index=1/3 status=0",
    "[verify] target pass begin name=resource-limited index=2/3 target_count=2 targets=//:resource-a //:resource-b",
    "✗ Fail: root//:resource-a (2.0s)",
    "✓ Pass: root//:resource-b (2.0s)",
    "[verify] buck2 test exit iso=v-123 pass=resource-limited status=32 end_s=130 duration_s=20 pass_count=1 fail_count=1 completions=2 threads=2",
    "[verify] target pass end name=resource-limited index=2/3 status=32",
    "[verify] target pass begin name=shared index=3/3 target_count=2 targets=//:shared-a //:shared-b",
    "✗ Fail: root//:shared-a (1.0s)",
    "# [1970-01-01T00:02:05.000Z] ✗ Fail: root//:nested-expected-failure (1.0s)",
    "✓ Pass: root//:shared-b (1.0s)",
    "Tests finished: Pass 1. Fail 1. Fatal 0. Skip 0. Build failure 0",
    "1 TESTS FAILED",
    "  ✗ root//:shared-a",
    "[verify] buck2 test exit iso=v-123 pass=shared status=32 end_s=150 duration_s=20 pass_count=1 fail_count=1 completions=2 threads=8",
    "[verify] target pass end name=shared index=3/3 status=32",
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, true);
  assert.equal(st.fail, 2);
  assert.equal(st.buildFailure, 0);
  assert.equal(st.remaining, 0);
  assert.deepEqual(st.failed, ["root//:resource-a", "root//:shared-a"]);
});
