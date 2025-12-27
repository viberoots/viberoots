#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: derived counters ignore comment-prefixed fail lines", () => {
  const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[2025-01-01T00:00:00.000Z] # [2025-01-01T00:00:00.000Z] ✗ Fail: root//:expected_failure_inside_subtest (0.1s)
[2025-01-01T00:00:01.000Z] ✓ Pass: root//:real_pass (0.1s)
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.equal(st.done, false);
  assert.equal(st.fail, 0);
  assert.equal(st.pass, 1);
});
