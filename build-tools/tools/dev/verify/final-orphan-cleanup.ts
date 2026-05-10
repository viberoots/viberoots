#!/usr/bin/env zx-wrapper
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup";
import { appendVerifyLogLine } from "./process-control";
import { cleanupRegisteredBuckIsolations } from "./registered-buck-cleanup";

export async function runFinalOrphanBuckCleanup(opts: {
  logFile: string | null;
  stateFile: string;
  timedPhase: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}): Promise<void> {
  const previousGrace = process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS;
  process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS = "0";
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
    const registeredRes = await opts.timedPhase(
      "final-cleanup-registered-buck-isolations",
      async () =>
        await cleanupRegisteredBuckIsolations({
          stateFile: opts.stateFile,
          log: async (line) => await appendVerifyLogLine(opts.logFile, line),
          maxKills: Number.MAX_SAFE_INTEGER,
        }),
    );
    await appendVerifyLogLine(
      opts.logFile,
      `[verify] final registered buck cleanup: scanned_isolations=${registeredRes.scanned} candidates=${registeredRes.candidates} killed=${registeredRes.killed}`,
    );
  } catch {
  } finally {
    if (previousGrace === undefined) delete process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS;
    else process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS = previousGrace;
  }
}
