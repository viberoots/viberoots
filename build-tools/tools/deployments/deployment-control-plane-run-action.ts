#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { defaultRequestedBy, type DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
  type DeploymentControlPlaneApprovalGrantRequest,
  type DeploymentControlPlaneRunAction,
} from "./deployment-control-plane-contract.ts";
import { approvePendingSubmission } from "./deployment-control-plane-approve-action.ts";
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
  executionSnapshotPath: string;
  lifecycleState: string;
  requestedBy?: { principalId: string; displayName?: string };
  execution?: { currentStep?: string; mutationStartedAt?: string };
  deployRunId?: string;
  progressiveRollout?: any;
  approval?: any;
  latestAction?: {
    actionId: string;
    action: DeploymentControlPlaneRunAction;
    dedupe: { mode: "created" | "reused"; requestFingerprint: string; idempotencyKey?: string };
  };
};

function nextLifecycleState(lifecycleState: string, action: DeploymentControlPlaneRunAction) {
  if (action === "approve") {
    return { lifecycleState, rejectionCode: "no_longer_admitted" as const };
  }
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
  workspaceRoot?: string;
  recordsRoot: string;
  submissionPath: string;
  action: DeploymentControlPlaneRunAction;
  idempotencyKey?: string;
  requestedBy?: DeploymentPrincipal;
  approval?: DeploymentControlPlaneApprovalGrantRequest;
}) {
  const submission = await readControlPlaneJson<SubmissionRecord>(opts.submissionPath);
  const submittedAt = new Date().toISOString();
  const requestedBy = opts.requestedBy || defaultRequestedBy();
  const requestFingerprint = fingerprintControlPlanePayload({
    submissionId: submission.submissionId,
    action: opts.action,
    ...(opts.approval ? { approval: opts.approval } : {}),
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
    ...(opts.approval ? { approval: opts.approval } : {}),
  });
  if (dedupe.mode === "reused" && submission.latestAction?.actionId === actionId) {
    const status = await readDeploymentControlPlaneStatus({ submissionPath: opts.submissionPath });
    return runActionResponseFromSubmission(
      {
        ...status,
        latestAction: {
          ...status.latestAction!,
          dedupe: {
            ...status.latestAction!.dedupe,
            mode: "reused",
          },
        },
      },
      actionId,
      opts.action,
    );
  }
  if (opts.action === "approve") {
    if (!opts.workspaceRoot) {
      throw new Error("approve run action requires workspaceRoot");
    }
    const approved = await approvePendingSubmission({
      workspaceRoot: opts.workspaceRoot,
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
      ...(opts.approval ? { approval: opts.approval } : {}),
    });
    await writeControlPlaneJson(opts.submissionPath, approved);
    const status = await readDeploymentControlPlaneStatus({ submissionPath: opts.submissionPath });
    return runActionResponseFromSubmission(status, actionId, opts.action);
  }
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
