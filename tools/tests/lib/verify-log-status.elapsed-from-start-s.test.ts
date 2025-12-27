#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

test("verify-log-status: computes elapsed from [verify] start_s marker", () => {
  const saved = Date.now;
  try {
    // Pretend "now" is 165 seconds after start_s=100.
    (Date as any).now = () => (100 + 165) * 1000;
    const log = `[verify] buck2 test begin iso=v-1 start_s=100\n`;
    const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
    assert.equal(st.elapsed, "2:45");
  } finally {
    (Date as any).now = saved;
  }
});
