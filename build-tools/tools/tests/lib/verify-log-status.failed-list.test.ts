#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

test("verify-log-status: lists failing tests (deduped) and preserves order", () => {
  const log = `
[verify] buck2 test begin iso=v-1 start_s=100
[2025-01-01T00:00:00.000Z] ✗ Fail: root//:a (1.2s)
[2025-01-01T00:00:01.000Z] ✗ Fail: root//:b (2.3s)
[2025-01-01T00:00:02.000Z] ✗ Fail: root//:a (9.9s)
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.deepEqual(st.failed, ["root//:a", "root//:b"]);
});
