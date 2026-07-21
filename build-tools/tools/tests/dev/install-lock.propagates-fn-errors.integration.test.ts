#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withExclusiveInstallLock } from "../../dev/install/lock";

function lockPathForScope(key: string, scope: string): string {
  const digest = crypto.createHash("sha256").update(`${scope}::${key}`).digest("hex").slice(0, 16);
  const base =
    process.platform === "win32"
      ? path.join(os.tmpdir(), "viberoots-locks")
      : "/tmp/viberoots-locks";
  return path.join(base, `lock-${digest}.lck`);
}

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

test("install lock never evicts a live owner after the lease duration", async () => {
  const scope = await fsp.mkdtemp(path.join(os.tmpdir(), "install-lock-live-owner-"));
  const key = `lock-live-owner-${Date.now()}-${process.pid}`;
  const lockPath = lockPathForScope(key, scope);
  await fsp.mkdir(lockPath, { recursive: true });
  await fsp.writeFile(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: "1970-01-01T00:00:00.000Z" })}\n`,
  );
  const old = new Date(0);
  await fsp.utimes(lockPath, old, old);
  await fsp.utimes(path.join(lockPath, "owner.json"), old, old);
  let acquired = false;
  try {
    await assert.rejects(
      withExclusiveInstallLock(key, async () => void (acquired = true), {
        scopeRootAbs: scope,
        timeoutMs: 80,
        staleMs: 10,
      }),
      /Timed out acquiring install lock/,
    );
    assert.equal(acquired, false);
  } finally {
    await fsp.rm(lockPath, { recursive: true, force: true });
    await fsp.rm(scope, { recursive: true, force: true });
  }
});
