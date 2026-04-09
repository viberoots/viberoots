#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import { progressiveRolloutIsActive } from "./nixos-shared-host-progressive-rollout.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";
import { createNixosSharedHostWorkerId } from "./nixos-shared-host-control-plane-snapshot.ts";
import {
  acquireNixosSharedHostControlPlaneLocks,
  runNixosSharedHostControlPlaneWorker,
} from "./nixos-shared-host-control-plane-execution.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { reconcileNixosSharedHostRecoveredSubmission } from "./nixos-shared-host-recovery.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

function submissionsDir(recordsRoot: string) {
  return path.join(path.resolve(recordsRoot), "control-plane", "submissions");
}

export async function ensureNoActiveProgressiveRun(
  recordsRoot: string,
  lockScope: string,
  submissionId: string,
) {
  try {
    const entries = await fsp.readdir(submissionsDir(recordsRoot));
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(submissionsDir(recordsRoot), entry);
      const submission = JSON.parse(
        await fsp.readFile(filePath, "utf8"),
      ) as NixosSharedHostControlPlaneSubmission;
      if (submission.submissionId === submissionId || submission.lockScope !== lockScope) continue;
      if (progressiveRolloutIsActive(submission.progressiveRollout)) {
        throw new DeploymentAdmissionError(
          "supersedence_blocked",
          `active progressive rollout already exists for ${lockScope}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
}

export async function executeSubmittedNixosSharedHostControlPlaneRun(opts: {
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  deployRunId: string;
  recordsRoot: string;
  operationKind: string;
  deployment: any;
  onLockAcquired?: () => Promise<void> | void;
  gateEvaluator?: NixosSharedHostGateEvaluator;
}) {
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireNixosSharedHostControlPlaneLocks(opts.recordsRoot, opts.deployment);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      lockRejected: true,
    });
  }
  const workerId = createNixosSharedHostWorkerId(opts.snapshot.submissionId);
  let submission = { ...opts.submission, workerId, lifecycleState: "running" as const };
  await writeControlPlaneJson(opts.submissionPath, submission);
  try {
    await opts.onLockAcquired?.();
    const latestSubmission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
      opts.submissionPath,
    );
    if (
      latestSubmission.lifecycleState === "cancelled" ||
      latestSubmission.lifecycleState === "cancelling"
    ) {
      const cancelled = {
        ...latestSubmission,
        lifecycleState: "cancelled" as const,
        terminationReason: "cancelled" as const,
        completedAt: new Date().toISOString(),
      };
      await writeControlPlaneJson(opts.submissionPath, cancelled);
      throw Object.assign(new Error("shared control-plane run cancelled before mutation"), {
        submission: cancelled,
      });
    }
    submission = {
      ...latestSubmission,
      workerId,
      lifecycleState: "running",
      execution: {
        currentStep:
          opts.operationKind === "explicit_removal" || opts.operationKind === "provision_only"
            ? "provision"
            : "publish",
        mutationStartedAt: new Date().toISOString(),
      },
    };
    await writeControlPlaneJson(opts.submissionPath, submission);
    const result = await runNixosSharedHostControlPlaneWorker({
      submissionPath: opts.submissionPath,
      executionSnapshotPath: opts.executionSnapshotPath,
      workerId,
      deployRunId: opts.deployRunId,
      progressiveRollout: submission.progressiveRollout || opts.snapshot.progressiveRollout,
      ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
    });
    const latestCompleted = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
      opts.submissionPath,
    );
    const finalized =
      latestCompleted.cancellationRequested || latestCompleted.lifecycleState === "cancelling"
        ? await reconcileNixosSharedHostRecoveredSubmission({
            submissionPath: opts.submissionPath,
            recordsRoot: opts.recordsRoot,
          })
        : {
            ...submission,
            deployRunId: opts.deployRunId,
            completedAt: new Date().toISOString(),
            lifecycleState: "finished" as const,
            resultRecordPath: result.recordPath,
            finalOutcome: result.record.finalOutcome,
            ...(result.record.progressiveRollout
              ? { progressiveRollout: result.record.progressiveRollout }
              : {}),
          };
    if (!finalized.recovery) await writeControlPlaneJson(opts.submissionPath, finalized);
    return { submission: finalized, workerId, result };
  } catch (error) {
    if ((error as any)?.paused) {
      const paused = {
        ...submission,
        lifecycleState: "paused" as const,
        deployRunId: opts.deployRunId,
        progressiveRollout: (error as any).progressiveRollout,
      };
      await writeControlPlaneJson(opts.submissionPath, paused);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: paused,
      });
    }
    throw error;
  } finally {
    await releaseLock?.();
  }
}
