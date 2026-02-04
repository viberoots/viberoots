import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVerifyStatusText } from "../../lib/verify-log-status.ts";
import type { VerifyStatus } from "../../lib/verify-log-status.ts";

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
    source: "derived",
  };

  const out = formatVerifyStatusText(st, { isTty: false });
  assert.match(out, /Time elapsed:\s+1m23s/);
  assert.match(out, /\nTests so far:\n/);
  assert.match(out, /\n  Pass:\s+3\n/);
  assert.match(out, /\n  Skip:\s+1\n/);
  assert.match(out, /\nTests remaining:\s+7\n/);
  assert.match(out, /\nLog:\s+\/tmp\/verify\.log/);

  // The tail-log legacy formatter used a single line like:
  // "Tests so far:   Pass X. Fail Y. ..."
  assert.ok(!out.includes("Tests so far:   Pass"), "expected no one-line Pass/Fail summary");
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
    source: "summary",
  };
  const out = formatVerifyStatusText(st, { isTty: true });
  assert.match(out, /\u001b\[/, "expected ANSI escapes when tty=true");
});
