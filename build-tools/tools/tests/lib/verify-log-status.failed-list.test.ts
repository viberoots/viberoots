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

test("verify-log-status: failing tests list excludes nested temp targets outside pass scope", () => {
  const log = `
[verify] begin iso=v-1 start_s=100
[verify] target pass begin name=isolated index=1/2 target_count=2 targets=root//viberoots:wrapper root//viberoots:other
[2025-01-01T00:00:00.000Z] ✗ Fail: root//viberoots:wrapper (1.2s)
[2025-01-01T00:00:01.000Z] # [2025-01-01T00:00:01.000Z] ✗ Fail: root//projects/apps/pytester:pytester_test (2.3s)
[2025-01-01T00:00:02.000Z]     [2025-01-01T00:00:01.000Z] ✗ Fail: root//projects/apps/pytester:pytester_test (2.3s)
[2025-01-01T00:00:03.000Z] ✓ Pass: root//viberoots:other (0.1s)
[verify] buck2 test exit iso=v-1 pass=isolated status=32 end_s=110 duration_s=10 pass_count=1 fail_count=1 completions=2 threads=1
[verify] target pass end name=isolated index=1/2 status=32
[verify] target pass begin name=shared index=2/2 target_count=1 targets=root//viberoots:shared
[2025-01-01T00:00:04.000Z] ✓ Pass: root//viberoots:shared (0.1s)
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.equal(st.fail, 1);
  assert.deepEqual(st.failed, ["root//viberoots:wrapper"]);
});

test("verify-log-status: failing tests list stays empty when only nested temp targets fail", () => {
  const log = `
[verify] begin iso=v-1 start_s=100
[verify] target pass begin name=isolated index=1/2 target_count=1 targets=root//viberoots:wrapper
[2025-01-01T00:00:01.000Z] # [2025-01-01T00:00:01.000Z] ✗ Fail: root//projects/apps/pytester:pytester_test (2.3s)
[2025-01-01T00:00:02.000Z]     [2025-01-01T00:00:01.000Z] ✗ Fail: root//projects/apps/pytester:pytester_test (2.3s)
[2025-01-01T00:00:03.000Z] ✓ Pass: root//viberoots:wrapper (0.1s)
[verify] buck2 test exit iso=v-1 pass=isolated status=0 end_s=110 duration_s=10 pass_count=1 fail_count=0 completions=1 threads=1
[verify] target pass end name=isolated index=1/2 status=0
[verify] target pass begin name=shared index=2/2 target_count=1 targets=root//viberoots:shared
[2025-01-01T00:00:04.000Z] ✓ Pass: root//viberoots:shared (0.1s)
`;
  const st = computeVerifyStatusFromLogText({ logPath: "/tmp/x.log", pid: 1, text: log });
  assert.equal(st.fail, 0);
  assert.deepEqual(st.failed, []);
});
