#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

test("verify-log-status: when done and end_s is missing, elapsed is unknown", () => {
  const saved = Date.now;
  try {
    (Date as any).now = () => 999_999_999_000;
    const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[verify] buck2 test exit iso=v-1 status=0
`;
    const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
    assert.equal(st.done, true);
    assert.equal(st.elapsed, undefined);
  } finally {
    (Date as any).now = saved;
  }
});
