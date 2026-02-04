#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: parses Remaining count when present", () => {
  const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[2025-01-01T00:00:00.000Z] Loading targets. Remaining: 123
[2025-01-01T00:00:01.000Z] ✓ Pass: root//:x (0.1s)
[2025-01-01T00:00:02.000Z] Remaining: 7
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.equal(st.remaining, 7);
});
