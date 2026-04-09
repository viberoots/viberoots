#!/usr/bin/env zx-wrapper
import {
  acquireNixosSharedHostControlPlaneLocks,
  runNixosSharedHostControlPlaneWorker,
} from "./nixos-shared-host-control-plane-execution.ts";
import { createNixosSharedHostWorkerId } from "./nixos-shared-host-control-plane-snapshot.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import {
  createNixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";

export async function abortPausedProgressiveRun(opts: {
  recordsRoot: string;
  submissionPath: string;
  submission: any;
  actionId: string;
  submittedAt: string;
  requestedBy: unknown;
  dedupe: { mode: "created" | "reused"; requestFingerprint: string; idempotencyKey?: string };
}) {
  const snapshot = await readControlPlaneJson<any>(opts.submission.executionSnapshotPath);
  const rollout = opts.submission.progressiveRollout
    ? { ...opts.submission.progressiveRollout, state: "aborted", resumable: false }
    : undefined;
  const record = createNixosSharedHostDeployRecord(snapshot.deployment, {
    deployRunId: opts.submission.deployRunId || `deploy-abort-${Date.now()}`,
    runClassification:
      opts.submission.operationKind === "explicit_removal"
        ? "explicit_removal"
        : opts.submission.operationKind,
    operationKind:
      opts.submission.operationKind === "explicit_removal"
        ? "deploy"
        : opts.submission.operationKind,
    finalOutcome: "aborted",
    componentResults: rollout?.componentResults || [],
    ...(rollout ? { progressiveRollout: rollout } : {}),
  });
  const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
  const aborted = {
    ...opts.submission,
    lifecycleState: "finished" as const,
    completedAt: opts.submittedAt,
    deployRunId: record.deployRunId,
    resultRecordPath: recordPath,
    finalOutcome: "aborted",
    progressiveRollout: rollout,
    latestAction: {
      actionId: opts.actionId,
      action: "abort" as const,
      submittedAt: opts.submittedAt,
      dedupe: opts.dedupe,
      lifecycleState: "finished" as const,
      requestedBy: opts.requestedBy,
    },
  };
  await writeControlPlaneJson(opts.submissionPath, aborted);
}

export async function resumePausedProgressiveRun(opts: {
  recordsRoot: string;
  submissionPath: string;
  submission: any;
  updated: any;
}) {
  const snapshot = await readControlPlaneJson<any>(opts.submission.executionSnapshotPath);
  const workerId = createNixosSharedHostWorkerId(opts.submission.submissionId);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireNixosSharedHostControlPlaneLocks(
      opts.recordsRoot,
      snapshot.deployment,
    );
    await writeControlPlaneJson(opts.submissionPath, {
      ...opts.updated,
      workerId,
      lifecycleState: "running",
    });
    const result = await runNixosSharedHostControlPlaneWorker({
      submissionPath: opts.submissionPath,
      executionSnapshotPath: opts.submission.executionSnapshotPath,
      workerId,
      deployRunId: opts.submission.deployRunId,
      progressiveRollout: opts.submission.progressiveRollout,
    });
    await writeControlPlaneJson(opts.submissionPath, {
      ...opts.updated,
      workerId,
      lifecycleState: "finished",
      completedAt: new Date().toISOString(),
      deployRunId: result.record.deployRunId,
      resultRecordPath: result.recordPath,
      finalOutcome: result.record.finalOutcome,
      progressiveRollout: result.record.progressiveRollout,
    });
  } catch (error) {
    if ((error as any)?.paused) {
      await writeControlPlaneJson(opts.submissionPath, {
        ...opts.updated,
        workerId,
        lifecycleState: "paused",
        progressiveRollout: (error as any).progressiveRollout,
      });
      return;
    }
    throw error;
  } finally {
    await releaseLock?.();
  }
}
