#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { defaultRequestedBy, type DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
  type DeploymentControlPlaneAuthorizationDecision,
  type DeploymentControlPlaneRunAction,
} from "./deployment-control-plane-contract.ts";
import {
  resolveRunActionIdempotency,
  fingerprintControlPlanePayload,
} from "./deployment-control-plane-idempotency.ts";
import { runActionResponseFromSubmission } from "./deployment-control-plane-status.ts";
import {
  abortPausedProgressiveRun,
  resumePausedProgressiveRun,
} from "./deployment-control-plane-progressive-run-action.ts";
import {
  readControlPlaneJson,
  runActionRequestPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { readDeploymentControlPlaneStatus } from "./deployment-control-plane-read.ts";

type SubmissionRecord = {
  submissionId: string;
  submittedAt: string;
  deploymentId: string;
  deploymentLabel: string;
  operationKind: string;
  providerTargetIdentity: string;
  lockScope: string;
  executionSnapshotPath: string;
  lifecycleState:
    | "pending_approval"
    | "queued"
    | "waiting_for_lock"
    | "running"
    | "paused"
    | "cancelling"
    | "finished"
    | "cancelled";
  terminationReason: "cancelled" | "superseded" | "no_longer_admitted" | "lock_timeout" | null;
  dedupe: {
    mode: "created" | "reused";
    requestFingerprint: string;
    idempotencyKey?: string;
  };
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  execution?: {
    currentStep:
      | "provision"
      | "publish"
      | "smoke"
      | "release_actions.pre_publish"
      | "release_actions.post_publish_pre_smoke"
      | "release_actions.post_smoke";
    mutationStartedAt?: string;
  };
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  progressiveRollout?: any;
  cancellationRequested?: {
    requestedAt: string;
    requestedBy: DeploymentPrincipal;
  };
  cancellationSummary?: {
    requestedAt: string;
    requestedBy: DeploymentPrincipal;
    activeStep:
      | "provision"
      | "publish"
      | "smoke"
      | "release_actions.pre_publish"
      | "release_actions.post_publish_pre_smoke"
      | "release_actions.post_smoke";
    mutationMayHaveStarted: boolean;
    enteredReconciliation: boolean;
    terminalizationPath:
      | "cancelled_without_mutation"
      | "finished_after_reconciliation"
      | "failed_after_reconciliation";
  };
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume" | "abort";
    submittedAt: string;
    dedupe: {
      mode: "created" | "reused";
      requestFingerprint: string;
      idempotencyKey?: string;
    };
    lifecycleState:
      | "pending_approval"
      | "queued"
      | "waiting_for_lock"
      | "running"
      | "paused"
      | "cancelling"
      | "finished"
      | "cancelled";
    requestedBy?: DeploymentPrincipal;
    rejectionCode?:
      | "lock_conflict"
      | "approval_required"
      | "approval_no_longer_valid"
      | "idempotency_conflict"
      | "unauthorized"
      | "no_longer_admitted"
      | "not_resumable"
      | "not_paused";
  };
};

function nextLifecycleState(
  lifecycleState: SubmissionRecord["lifecycleState"],
  action: DeploymentControlPlaneRunAction,
) {
  if (action === "resume") {
    return lifecycleState === "paused"
      ? { lifecycleState: "running" as const }
      : { lifecycleState, rejectionCode: "not_resumable" as const };
  }
  if (action === "abort") {
    return lifecycleState === "paused"
      ? { lifecycleState: "finished" as const }
      : { lifecycleState, rejectionCode: "not_paused" as const };
  }
  if (
    lifecycleState === "pending_approval" ||
    lifecycleState === "queued" ||
    lifecycleState === "waiting_for_lock"
  ) {
    return {
      lifecycleState: "cancelled" as const,
      terminationReason: "cancelled" as const,
      completedAt: new Date().toISOString(),
    };
  }
  if (lifecycleState === "running" || lifecycleState === "cancelling") {
    return { lifecycleState: "cancelling" as const };
  }
  return { lifecycleState, rejectionCode: "no_longer_admitted" as const };
}

export async function submitDeploymentControlPlaneRunAction(opts: {
  recordsRoot: string;
  submissionPath: string;
  action: DeploymentControlPlaneRunAction;
  idempotencyKey?: string;
  requestedBy?: DeploymentPrincipal;
}) {
  const submission = await readControlPlaneJson<SubmissionRecord>(opts.submissionPath);
  const submittedAt = new Date().toISOString();
  const requestedBy = opts.requestedBy || defaultRequestedBy();
  const requestFingerprint = fingerprintControlPlanePayload({
    submissionId: submission.submissionId,
    action: opts.action,
  });
  const dedupe = await resolveRunActionIdempotency({
    recordsRoot: opts.recordsRoot,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint,
    actionId: randomUUID(),
  });
  const actionId = dedupe.targetId;
  const requestPath = runActionRequestPathFor(opts.recordsRoot, actionId);
  await writeControlPlaneJson(requestPath, {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
    actionId,
    submittedAt,
    submissionId: submission.submissionId,
    action: opts.action,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  });
  const next = nextLifecycleState(submission.lifecycleState, opts.action);
  if (opts.action === "abort" && submission.lifecycleState === "paused") {
    await abortPausedProgressiveRun({
      recordsRoot: opts.recordsRoot,
      submissionPath: opts.submissionPath,
      submission,
      actionId,
      submittedAt,
      requestedBy,
      dedupe: {
        mode: dedupe.mode,
        requestFingerprint,
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
    });
    const status = await readDeploymentControlPlaneStatus({ submissionPath: opts.submissionPath });
    return runActionResponseFromSubmission(status, actionId, opts.action);
  }
  const updated = {
    ...submission,
    lifecycleState: next.lifecycleState,
    ...(next.terminationReason ? { terminationReason: next.terminationReason } : {}),
    ...(next.completedAt ? { completedAt: next.completedAt } : {}),
    latestAction: {
      actionId,
      action: opts.action,
      submittedAt,
      dedupe: {
        mode: dedupe.mode,
        requestFingerprint,
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
      lifecycleState: next.lifecycleState,
      requestedBy,
      ...(next.rejectionCode ? { rejectionCode: next.rejectionCode } : {}),
    },
    ...(next.lifecycleState === "cancelling"
      ? {
          cancellationRequested: {
            requestedAt: submittedAt,
            requestedBy,
          },
        }
      : {}),
    ...(next.lifecycleState === "cancelled"
      ? {
          cancellationSummary: {
            requestedAt: submittedAt,
            requestedBy,
            activeStep: submission.execution?.currentStep || "publish",
            mutationMayHaveStarted: !!submission.execution?.mutationStartedAt,
            enteredReconciliation: false,
            terminalizationPath: "cancelled_without_mutation" as const,
          },
        }
      : {}),
  };
  await writeControlPlaneJson(opts.submissionPath, updated);
  if (
    opts.action === "resume" &&
    submission.lifecycleState === "paused" &&
    submission.progressiveRollout?.resumable
  ) {
    await resumePausedProgressiveRun({
      recordsRoot: opts.recordsRoot,
      submissionPath: opts.submissionPath,
      submission,
      updated,
    });
  }
  const status = await readDeploymentControlPlaneStatus({ submissionPath: opts.submissionPath });
  return runActionResponseFromSubmission(status, actionId, opts.action);
}
