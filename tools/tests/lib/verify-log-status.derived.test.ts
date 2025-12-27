#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: derives pass count from full log with timestamp prefixes", () => {
  const log = [
    "[2025-12-26T14:34:46.923-08:00] ✓ Pass: root//:a (1.0s)",
    "[2025-12-26T14:34:47.000-08:00] ✓ Pass: root//:b (2.0s)",
    "[2025-12-26T14:34:47.050-08:00] ✓ Pass: root//:b (2.0s)", // dup
  ].join("\n");

  const st = computeVerifyStatusFromLogText({
    logPath: "/repo/buck-out/tmp/verify-logs/verify-123.log",
    pid: 123,
    text: log,
  });

  assert.equal(st.done, false);
  assert.equal(st.source, "derived");
  assert.equal(st.pass, 2);
  assert.equal(st.fail, 0);
});
