import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup";
import { setupCoverage } from "./coverage";
import {
  enforceVerifyDiskGate,
  runVerifyHousekeeping,
  shouldRunNixStoreOptimizeForRequestedTargets,
  verifyTargetFreeGiBDefault,
} from "./housekeeping";
import { appendVerifyLogLine } from "./process-control";

export async function setupLocalVerifyWorkspace(opts: {
  root: string;
  zxInitPath: string;
  coverage: boolean;
  targets: string[];
}): Promise<{ rawDir: string | null }> {
  const targetFreeGiB = verifyTargetFreeGiBDefault(opts.coverage);
  const runNixStoreOptimize = shouldRunNixStoreOptimizeForRequestedTargets(opts.targets);
  const { freeGiB } = await runVerifyHousekeeping({
    root: opts.root,
    targetFreeGiB,
    zxInitPath: opts.zxInitPath,
    runNixStoreOptimize,
  });
  enforceVerifyDiskGate({ freeGiB, targetFreeGiB });
  return await setupCoverage({ root: opts.root, enabled: opts.coverage });
}

export async function cleanupLocalOrphanBuckDaemons(logFile: string | null): Promise<void> {
  try {
    const res = await cleanupOrphanBuckDaemons({
      log: async (line) => await appendVerifyLogLine(logFile, line),
      maxKills: 50,
      includeOwnerlessEphemeral: true,
    });
    await appendVerifyLogLine(
      logFile,
      `[verify] buck2 orphan cleanup: scanned_forkservers=${res.scanned} candidates=${res.candidates} killed=${res.killed}`,
    );
  } catch {}
}
