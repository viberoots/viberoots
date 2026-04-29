#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { cleanupOrphanBuckDaemons } from "../../dev/verify/buck-orphan-cleanup";
import { cleanupCurrentVerifyEnvProcesses } from "../../dev/verify/verify-owned-orphan-cleanup";
import {
  cleanupProcessFiles,
  createProcessFiles,
  spawnCurrentVerifyEnvProcess,
  spawnOrphanedVerifyProcess,
  waitForPidGone,
} from "./verify.orphan-owned-process-cleanup.helpers";

test("verify orphan cleanup: kills orphaned verify-owned node processes only", async () => {
  const files = await createProcessFiles({ kind: "orphan-owned", ownerPid: 999999 });
  const orphanPid = await spawnOrphanedVerifyProcess({
    files,
    registered: true,
    target: "root//:verify_orphan_owned_process_cleanup",
  });

  const prevGrace = process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
  process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const result = await cleanupOrphanBuckDaemons({ maxKills: 20 });
    assert.ok(
      result.killed >= 1,
      `expected orphan cleanup to kill at least one process, got ${JSON.stringify(result)}`,
    );
    await waitForPidGone(orphanPid, 10_000);
  } finally {
    if (prevGrace === undefined) delete process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
    else process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = prevGrace;
    try {
      process.kill(orphanPid, "SIGKILL");
    } catch {}
    await cleanupProcessFiles(files);
  }
});

test("verify orphan cleanup: kills orphaned verify-env test processes without registration", async () => {
  const files = await createProcessFiles({ kind: "orphan-env", ownerPid: 999998 });
  const orphanPid = await spawnOrphanedVerifyProcess({
    files,
    registered: false,
    target: "root//:verify_orphan_env_process_cleanup",
  });

  const prevGrace = process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
  process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const result = await cleanupOrphanBuckDaemons({ maxKills: 20 });
    assert.ok(
      result.killed >= 1,
      `expected orphan cleanup to kill at least one process, got ${JSON.stringify(result)}`,
    );
    await waitForPidGone(orphanPid, 10_000);
  } finally {
    if (prevGrace === undefined) delete process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS;
    else process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS = prevGrace;
    try {
      process.kill(orphanPid, "SIGKILL");
    } catch {}
    await cleanupProcessFiles(files);
  }
});

test("verify env cleanup: kills current-run verify test process groups without registration", async () => {
  const files = await createProcessFiles({ kind: "current-env", ownerPid: process.pid });
  const child = spawnCurrentVerifyEnvProcess(files, "root//:verify_current_env_process_cleanup");
  assert.ok(child.pid && child.pid > 1);
  child.unref();

  try {
    const result = await cleanupCurrentVerifyEnvProcesses({
      stateFile: files.stateFile,
      logFile: files.logFile,
      maxKills: 20,
    });
    assert.equal(result.killed, 1, `expected one kill, got ${JSON.stringify(result)}`);
    await waitForPidGone(child.pid, 10_000);
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {}
    await cleanupProcessFiles(files);
  }
});
