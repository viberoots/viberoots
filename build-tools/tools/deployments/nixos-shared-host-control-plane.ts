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
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostControlPlaneSubmission,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";
import {
  createNixosSharedHostControlPlaneSnapshot,
  createNixosSharedHostSubmissionId,
  createNixosSharedHostWorkerId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot.ts";
import { evaluateNixosSharedHostControlPlaneAdmission } from "./nixos-shared-host-control-plane-admission.ts";
import { createAdmissionFailureSubmission } from "./nixos-shared-host-control-plane-admission-failure.ts";
import {
  ensureNoActiveProgressiveRun,
  executeSubmittedNixosSharedHostControlPlaneRun,
} from "./nixos-shared-host-control-plane-submit-helpers.ts";
import { writeNixosSharedHostProvisionerPlan } from "./nixos-shared-host-provisioner-plan.ts";
import {
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import {
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";

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

type SubmitResult = {
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: NixosSharedHostDeployRecord;
  recordPath: string;
};

export async function submitNixosSharedHostControlPlaneRun(
  opts: SubmitOpts,
): Promise<SubmitResult> {
  const submissionId = opts.submissionId || createNixosSharedHostSubmissionId();
  const dedupe = opts.dedupe || directControlPlaneDedupe(submissionId);
  const snapshot = await createNixosSharedHostControlPlaneSnapshot(opts, submissionId);
  const deployRunId = createNixosSharedHostDeployRunId();
  snapshot.provisionerPlan = await writeNixosSharedHostProvisionerPlan({ snapshot });
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await opts.hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  try {
    await ensureNoActiveProgressiveRun(opts.paths.recordsRoot, snapshot.lockScope, submissionId);
    await evaluateNixosSharedHostControlPlaneAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      deployment: opts.deployment,
      snapshot,
      source: opts.source,
      artifactLineageId: opts.artifactLineageId,
      admissionEvidence: opts.admissionEvidence,
    });
    if (snapshot.admittedContext) {
      await writeControlPlaneJson(executionSnapshotPath, snapshot);
    }
  } catch (error) {
    const submission = createAdmissionFailureSubmission({
      error,
      snapshot,
      executionSnapshotPath,
      dedupe,
      requestedBy: opts.requestedBy,
      authorization: opts.authorization,
    });
    if (submission) {
      await writeControlPlaneJson(submissionPath, submission);
      throw Object.assign(error, {
        submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    throw error;
  }
  let submission = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: "shared_nonprod" },
    lifecycleState: "queued",
    dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
    deployRunId,
  });
  await writeControlPlaneJson(submissionPath, submission);
  submission = {
    ...submission,
    lifecycleState: "waiting_for_lock",
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    const { submission: completed, result } = await executeSubmittedNixosSharedHostControlPlaneRun({
      submission,
      submissionPath,
      executionSnapshotPath,
      snapshot,
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
      lockScope: snapshot.lockScope,
      record: result.record,
      recordPath: result.recordPath,
    };
  } catch (error) {
    if ((error as any)?.lockRejected) {
      const rejected = createNixosSharedHostControlPlaneSubmission(
        snapshot,
        executionSnapshotPath,
        {
          admission: { decision: "rejected", reason: "lock_conflict" },
          lifecycleState: "finished",
          completedAt: new Date().toISOString(),
          dedupe,
          requestedBy: opts.requestedBy,
          authorization: opts.authorization,
          rejectionCode: "lock_conflict",
          ...(snapshot.progressiveRollout
            ? { progressiveRollout: snapshot.progressiveRollout }
            : {}),
          deployRunId,
        },
      );
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
