#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

test("verify-log-status: summary with Fail 0 clears failing-tests list", () => {
  const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[2025-01-01T00:00:01.000Z] ✗ Fail: root//:some_expected_failure (0.1s)
[2025-01-01T00:00:02.000Z] ✓ Pass: root//:overall_suite (0.1s)
Tests finished: Pass 2. Fail 0. Fatal 0. Skip 0. Build failure 0
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.equal(st.done, true);
  assert.equal(st.fail, 0);
  assert.deepEqual(st.failed, []);
});
