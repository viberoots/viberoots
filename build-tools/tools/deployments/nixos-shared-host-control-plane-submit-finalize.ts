#!/usr/bin/env zx-wrapper
import { reconcileNixosSharedHostRecoveredSubmission } from "./nixos-shared-host-recovery";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract";

export async function recoverControlPlaneSubmission(opts: {
  submissionPath: string;
  recordsRoot: string;
  persistSubmission?: (submission: NixosSharedHostControlPlaneSubmission) => Promise<void>;
  recoverSubmission?: (args: {
    submissionPath: string;
    recordsRoot: string;
  }) => Promise<NixosSharedHostControlPlaneSubmission>;
}) {
  const recovered = opts.recoverSubmission
    ? await opts.recoverSubmission({
        submissionPath: opts.submissionPath,
        recordsRoot: opts.recordsRoot,
      })
    : await reconcileNixosSharedHostRecoveredSubmission({
        submissionPath: opts.submissionPath,
        recordsRoot: opts.recordsRoot,
      });
  await opts.persistSubmission?.(recovered);
  return recovered;
}

export function finalizeSubmissionFromRecordedError(
  submission: NixosSharedHostControlPlaneSubmission,
  deployRunId: string,
  error: unknown,
) {
  return {
    ...submission,
    completedAt: new Date().toISOString(),
    lifecycleState: "finished" as const,
    deployRunId: (error as any)?.record?.deployRunId || deployRunId,
    resultRecordPath: (error as any).recordPath,
    ...(typeof (error as any)?.record?.finalOutcome === "string"
      ? { finalOutcome: (error as any).record.finalOutcome }
      : {}),
    ...((error as any)?.progressiveRollout
      ? { progressiveRollout: (error as any).progressiveRollout }
      : {}),
  };
}
