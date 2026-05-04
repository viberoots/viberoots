#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { withExclusiveInstallLock } from "../../dev/install/lock";

test("install lock propagates fn errors without retry loop", async () => {
  const key = `lock-propagates-fn-errors-${Date.now()}-${process.pid}`;
  let calls = 0;
  await assert.rejects(
    withExclusiveInstallLock(
      key,
      async () => {
        calls += 1;
        throw new Error("boom");
      },
      { timeoutMs: 2000, staleMs: 2000 },
    ),
    /boom/,
  );
  assert.equal(calls, 1);
});
