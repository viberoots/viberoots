#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import { directControlPlaneDedupe } from "./deployment-control-plane-idempotency.ts";
import {
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostControlPlaneSubmission,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-submit-helpers.ts";
import {
  createLockConflictSubmission,
  createWaitTerminalSubmission,
} from "./nixos-shared-host-control-plane-terminal.ts";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import {
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import {
  prepareNixosSharedHostControlPlaneRun,
  type PrepareNixosSharedHostControlPlaneRunOpts,
} from "./nixos-shared-host-control-plane-prepare.ts";
import {
  createNixosSharedHostSubmissionId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot.ts";

type SubmitOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  hooks?: {
    afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
    onLockAcquired?: () => Promise<void> | void;
    gateEvaluator?: NixosSharedHostGateEvaluator;
  };
};

export async function prepareSubmittedNixosSharedHostControlPlaneRun(
  opts: Omit<SubmitOpts, "dedupe"> & {
    dedupe?: DeploymentControlPlaneRequestDedupe;
  },
) {
  const submissionId = opts.submissionId || createNixosSharedHostSubmissionId();
  const dedupe = opts.dedupe || directControlPlaneDedupe(submissionId || "direct");
  return await prepareNixosSharedHostControlPlaneRun({
    ...(opts as Omit<PrepareNixosSharedHostControlPlaneRunOpts, "submissionId" | "dedupe">),
    submissionId,
    dedupe,
  });
}

export async function submitNixosSharedHostControlPlaneRun(opts: SubmitOpts): Promise<{
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: NixosSharedHostDeployRecord;
  recordPath: string;
}> {
  const prepared = await prepareSubmittedNixosSharedHostControlPlaneRun(opts);
  let { submission, submissionPath, executionSnapshotPath, lockScope, snapshot, deployRunId } =
    prepared;
  const dedupe = submission.dedupe;
  try {
    const { submission: completed, result } = await executeSubmittedNixosSharedHostControlPlaneRun({
      submission,
      submissionPath,
      executionSnapshotPath,
      snapshot,
      workspaceRoot: opts.workspaceRoot,
      deployRunId,
      recordsRoot: opts.paths.recordsRoot,
      operationKind: opts.operationKind,
      deployment: opts.deployment,
      ...(opts.hooks?.onLockAcquired ? { onLockAcquired: opts.hooks.onLockAcquired } : {}),
      ...(opts.hooks?.gateEvaluator ? { gateEvaluator: opts.hooks.gateEvaluator } : {}),
    });
    submission = completed;
    return {
      submission,
      submissionPath,
      executionSnapshotPath,
      lockScope,
      record: result.record,
      recordPath: result.recordPath,
    };
  } catch (error) {
    if ((error as any)?.waitAborted) {
      const terminationReason = (error as any).waitAbortReason;
      const ended = createWaitTerminalSubmission(snapshot, executionSnapshotPath, {
        terminationReason,
        dedupe,
        requestedBy: opts.requestedBy,
        authorization: opts.authorization,
        deployRunId,
      });
      await writeControlPlaneJson(submissionPath, ended);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: ended,
        submissionPath,
        executionSnapshotPath,
      });
    }
    if ((error as any)?.lockTimeout) {
      const timedOut = createWaitTerminalSubmission(snapshot, executionSnapshotPath, {
        terminationReason: "lock_timeout",
        dedupe,
        requestedBy: opts.requestedBy,
        authorization: opts.authorization,
        deployRunId,
      });
      await writeControlPlaneJson(submissionPath, timedOut);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: timedOut,
        submissionPath,
        executionSnapshotPath,
      });
    }
    if ((error as any)?.lockRejected) {
      const rejected = createLockConflictSubmission(snapshot, executionSnapshotPath, {
        dedupe,
        requestedBy: opts.requestedBy,
        authorization: opts.authorization,
        deployRunId,
      });
      await writeControlPlaneJson(submissionPath, rejected);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: rejected,
        submissionPath,
        executionSnapshotPath,
      });
    }
    if ((error as any)?.paused) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: (error as any).submission || submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    if ((error as any)?.submission) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: (error as any).submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      lifecycleState: "finished",
      deployRunId,
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.deployRunId
        ? { deployRunId: (error as any).record.deployRunId }
        : {}),
      ...((error as any)?.record?.finalOutcome
        ? { finalOutcome: (error as any).record.finalOutcome }
        : {}),
      ...((error as any)?.progressiveRollout
        ? { progressiveRollout: (error as any).progressiveRollout }
        : {}),
    };
    await writeControlPlaneJson(submissionPath, submission);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission,
      submissionPath,
      executionSnapshotPath,
    });
  }
}
