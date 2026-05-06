import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVerifyStatusText } from "../../lib/verify-log-status";
import type { VerifyStatus } from "../../lib/verify-log-status";

test("verify-log-status: formatVerifyStatusText renders multiline (not one-line summary)", () => {
  const st: VerifyStatus = {
    pid: 123,
    logPath: "/tmp/verify.log",
    pass: 3,
    fail: 0,
    fatal: 0,
    skip: 1,
    buildFailure: 0,
    remaining: 7,
    failed: [],
    done: false,
    elapsed: "1m23s",
    completionRateAvgPerMinute: 2.8915,
    completionRateRecentPerMinute: 4,
    gcDetected: true,
    source: "derived",
  };

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(out, /Time elapsed:\s+1m23s/);
  assert.match(out, /Projected:       \? duration, \? end/);
  assert.match(out, /Tests:           \[████████████░░░░░░░░░░░░░░░░░░░░\] 4\/11/);
  assert.match(out, /Time:            \?\n/);
  assert.match(out, /Completion rate:\s+2\.9 tests\/min total avg, 4\.0 tests\/min recent avg/);
  assert.match(out, /\nTests so far:\n/);
  assert.match(out, /\n  Pass:\s+3\n/);
  assert.match(out, /\n  Skip:\s+1\n/);
  assert.match(out, /\nTests remaining:\s+7\n/);
  assert.match(out, /\nGC detected:\s+yes\n/);
  assert.match(out, /\n\/tmp\/verify\.log/);
  assert.doesNotMatch(out, /\nLog:\s+\/tmp\/verify\.log/);

  // The tail-log legacy formatter used a single line like:
  // "Tests so far:   Pass X. Fail Y. ..."
  assert.ok(!out.includes("Tests so far:   Pass"), "expected no one-line Pass/Fail summary");
});

test("verify-log-status: progress bars align and fill when projection is available", () => {
  const st: VerifyStatus = {
    pid: 123,
    logPath: "/tmp/verify.log",
    pass: 6,
    fail: 0,
    fatal: 0,
    skip: 0,
    buildFailure: 0,
    remaining: 2,
    failed: [],
    done: false,
    elapsed: "4:00",
    projectedDuration: "8:00",
    projectedEndTime: "6:30 PM",
    gcDetected: false,
    source: "derived",
  };

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(out, /Projected:       8:00 duration, 6:30 PM end/);
  assert.match(out, /Tests:           \[████████████████████████░░░░░░░░\] 6\/8/);
  assert.match(out, /Time:            \[████████████████░░░░░░░░░░░░░░░░\] 4:00 \/ 8:00/);
});

test("verify-log-status: formatVerifyStatusText includes ANSI color when tty=true", () => {
  const st: VerifyStatus = {
    pid: 1,
    logPath: "/tmp/verify.log",
    pass: 0,
    fail: 0,
    fatal: 0,
    skip: 0,
    buildFailure: 0,
    remaining: 0,
    failed: [],
    done: true,
    elapsed: "0s",
    gcDetected: false,
    source: "summary",
  };
  const out = formatVerifyStatusText(st, { isTty: true });
  assert.match(out, /\u001b\[/, "expected ANSI escapes when tty=true");
});
