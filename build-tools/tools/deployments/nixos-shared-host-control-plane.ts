#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
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
import {
  acquireNixosSharedHostControlPlaneLocks,
  runNixosSharedHostControlPlaneWorker,
} from "./nixos-shared-host-control-plane-execution.ts";
import {
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

type SubmitHooks = {
  afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
  onLockAcquired?: () => Promise<void> | void;
};

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
  hooks?: SubmitHooks;
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
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await opts.hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  try {
    if (snapshot.admittedContext) {
      snapshot.admittedContext = {
        ...snapshot.admittedContext,
        policyEvaluation: await evaluateDeploymentAdmission({
          workspaceRoot: opts.workspaceRoot,
          recordsRoot: opts.paths.recordsRoot,
          deployment: opts.deployment,
          operationKind: snapshot.operationKind,
          admittedContext: snapshot.admittedContext,
          sourceRecord: opts.source?.record as any,
          artifactLineageId: opts.artifactLineageId,
          evidence: opts.admissionEvidence,
        }),
      };
      await writeControlPlaneJson(executionSnapshotPath, snapshot);
    }
  } catch (error) {
    if (error instanceof DeploymentAdmissionError) {
      const pending =
        error.code === "approval_required" || error.code === "approval_no_longer_valid";
      const submission = createNixosSharedHostControlPlaneSubmission(
        snapshot,
        executionSnapshotPath,
        {
          admission: pending
            ? { decision: "pending_approval", reason: error.code }
            : { decision: "rejected", reason: error.code },
          lifecycleState: pending ? "pending_approval" : "finished",
          dedupe,
          requestedBy: opts.requestedBy,
          authorization: opts.authorization,
          ...(pending ? { pendingReasonCode: error.code } : { rejectionCode: error.code }),
          ...(pending
            ? {}
            : {
                completedAt: new Date().toISOString(),
                terminationReason: "no_longer_admitted" as const,
              }),
        },
      );
      await writeControlPlaneJson(submissionPath, submission);
      throw Object.assign(error, {
        submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    throw error;
  }
  let releaseLock: (() => Promise<void>) | undefined;
  let submission = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: "shared_nonprod" },
    lifecycleState: "queued",
    dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
  });
  await writeControlPlaneJson(submissionPath, submission);
  submission = {
    ...submission,
    lifecycleState: "waiting_for_lock",
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    releaseLock = await acquireNixosSharedHostControlPlaneLocks(
      opts.paths.recordsRoot,
      opts.deployment,
    );
  } catch (error) {
    const rejected = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
      admission: {
        decision: "rejected",
        reason: "lock_conflict",
      },
      lifecycleState: "finished",
      completedAt: new Date().toISOString(),
      dedupe,
      requestedBy: opts.requestedBy,
      authorization: opts.authorization,
      rejectionCode: "lock_conflict",
    });
    await writeControlPlaneJson(submissionPath, rejected);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission: rejected,
      submissionPath,
      executionSnapshotPath,
    });
  }
  const workerId = createNixosSharedHostWorkerId(submissionId);
  submission = {
    ...submission,
    workerId,
    lifecycleState: "running",
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    await opts.hooks?.onLockAcquired?.();
    const latestSubmission =
      await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(submissionPath);
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
      await writeControlPlaneJson(submissionPath, cancelled);
      throw Object.assign(new Error("shared control-plane run cancelled before mutation"), {
        submission: cancelled,
        submissionPath,
        executionSnapshotPath,
      });
    }
    const result = await runNixosSharedHostControlPlaneWorker({
      submissionPath,
      executionSnapshotPath,
      workerId,
    });
    submission = {
      ...submission,
      deployRunId: result.record.deployRunId,
      completedAt: new Date().toISOString(),
      lifecycleState: "finished",
      resultRecordPath: result.recordPath,
      finalOutcome: result.record.finalOutcome,
    };
    await writeControlPlaneJson(submissionPath, submission);
    return {
      submission,
      submissionPath,
      executionSnapshotPath,
      lockScope: snapshot.lockScope,
      record: result.record,
      recordPath: result.recordPath,
    };
  } catch (error) {
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      lifecycleState: "finished",
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.deployRunId
        ? { deployRunId: (error as any).record.deployRunId }
        : {}),
      ...((error as any)?.record?.finalOutcome
        ? { finalOutcome: (error as any).record.finalOutcome }
        : {}),
    };
    await writeControlPlaneJson(submissionPath, submission);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission,
      submissionPath,
      executionSnapshotPath,
    });
  } finally {
    await releaseLock?.();
  }
}
