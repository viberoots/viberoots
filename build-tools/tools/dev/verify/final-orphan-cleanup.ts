#!/usr/bin/env zx-wrapper
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup";
import { appendVerifyLogLine } from "./process-control";

export async function runFinalOrphanBuckCleanup(opts: {
  logFile: string | null;
  timedPhase: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}): Promise<void> {
  const previousGrace = process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS;
  process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const res = await opts.timedPhase(
      "final-cleanup-orphan-buck-daemons",
      async () =>
        await cleanupOrphanBuckDaemons({
          log: async (line) => await appendVerifyLogLine(opts.logFile, line),
          maxKills: 200,
          ignoreLiveOwnerPid: process.pid,
          includeOwnerlessEphemeral: false,
        }),
    );
    await appendVerifyLogLine(
      opts.logFile,
      `[verify] final buck2 orphan cleanup: scanned_forkservers=${res.scanned} candidates=${res.candidates} killed=${res.killed}`,
    );
  } catch {
  } finally {
    if (previousGrace === undefined) delete process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS;
    else process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS = previousGrace;
  }
}
