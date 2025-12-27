#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: parses remaining from 'Waiting on ... and N other actions' block", () => {
  const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[2025-01-01T00:00:01.000Z] Waiting on Test root//:foo --  [local_execute]
[2025-01-01T00:00:01.000Z] Waiting on Test root//:bar --  [local_execute]
[2025-01-01T00:00:01.000Z] Waiting on Test root//:baz --  [local_execute], and 9 other actions
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  // 9 other actions + 3 explicitly listed waiting actions
  assert.equal(st.remaining, 12);
});
