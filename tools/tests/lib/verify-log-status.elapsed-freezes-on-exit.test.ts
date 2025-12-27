#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: elapsed freezes using end_s once buck2 exit marker is present", () => {
  const saved = Date.now;
  try {
    // "Now" is far in the future; elapsed should still freeze at end_s-start_s.
    (Date as any).now = () => 999_999_999_000;
    const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[verify] buck2 test exit iso=v-1 status=0 end_s=160
`;
    const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
    assert.equal(st.done, true);
    assert.equal(st.elapsed, "1:00");
  } finally {
    (Date as any).now = saved;
  }
});
