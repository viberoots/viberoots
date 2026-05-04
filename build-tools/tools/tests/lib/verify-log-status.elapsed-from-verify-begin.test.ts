#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

test("verify-log-status: computes elapsed from verify begin marker before buck2 starts", () => {
  const saved = Date.now;
  try {
    (Date as any).now = () => (100 + 165) * 1000;
    const log = `[verify] begin iso=v-1 start_s=100\n`;
    const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
    assert.equal(st.elapsed, "2:45");
  } finally {
    (Date as any).now = saved;
  }
});

test("verify-log-status: keeps elapsed anchored at verify begin after buck2 starts", () => {
  const saved = Date.now;
  try {
    (Date as any).now = () => (100 + 165) * 1000;
    const log = [
      "[verify] begin iso=v-1 start_s=100",
      "[verify] buck2 test begin iso=v-1 start_s=140",
    ].join("\n");
    const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
    assert.equal(st.elapsed, "2:45");
  } finally {
    (Date as any).now = saved;
  }
});
