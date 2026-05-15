#!/usr/bin/env zx-wrapper
import { defaultRequestedBy, type DeploymentPrincipal } from "./deployment-admission-evidence";
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
  type DeploymentControlPlaneAuthorization,
  type DeploymentControlPlaneApprovalGrantRequest,
  type DeploymentControlPlaneRunAction,
} from "./deployment-control-plane-contract";
import { approvePendingSubmission } from "./deployment-control-plane-approve-action";
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency";
import { resolveDurableRunActionDedupe } from "./deployment-control-plane-run-action-dedupe";
import {
  nextRunActionLifecycleState,
  unsupportedBackendProgressiveRunAction,
} from "./deployment-control-plane-run-action-state";
import {
  writeBackendRunActionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  runActionResponseFromSubmission,
  statusFromSubmission,
} from "./deployment-control-plane-status";
import {
  abortPausedProgressiveRun,
  resumePausedProgressiveRun,
} from "./deployment-control-plane-progressive-run-action";
import {
  readControlPlaneJson,
  runActionRequestPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import { cleanupReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";
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
    dedupe: {
      mode: "created" | "reused" | "duplicate";
      requestFingerprint: string;
      idempotencyKey?: string;
    };
  };
};

export async function submitDeploymentControlPlaneRunAction(opts: {
  workspaceRoot?: string;
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  backendDatabaseUrl?: string;
  submissionPath: string;
  action: DeploymentControlPlaneRunAction;
  idempotencyKey?: string;
  requestedBy?: DeploymentPrincipal;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  approval?: DeploymentControlPlaneApprovalGrantRequest;
}) {
  const cleanupSnapshotIfTerminal = async () => {
    if (!opts.workspaceRoot) return;
    const latest = await readControlPlaneJson<SubmissionRecord>(opts.submissionPath);
    if (latest.lifecycleState !== "finished" && latest.lifecycleState !== "cancelled") return;
    const snapshot = await readControlPlaneJson<any>(latest.executionSnapshotPath).catch(
      () => undefined,
    );
    await cleanupReviewedSourceSnapshot(opts.workspaceRoot, snapshot);
  };
  const submission = await readControlPlaneJson<SubmissionRecord>(opts.submissionPath);
  const submittedAt = new Date().toISOString();
  const requestedBy = opts.requestedBy || defaultRequestedBy();
  const requestFingerprint = fingerprintControlPlanePayload({
    submissionId: submission.submissionId,
    action: opts.action,
    ...(opts.approval ? { approval: opts.approval } : {}),
  });
  const dedupe = await resolveDurableRunActionDedupe({
    recordsRoot: opts.recordsRoot,
    ...(opts.backend ? { backend: opts.backend } : {}),
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint,
  });
  const actionId = dedupe.targetId;
  const requestDoc = {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
    actionId,
    submittedAt,
    submissionId: submission.submissionId,
    action: opts.action,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    ...(opts.approval ? { approval: opts.approval } : {}),
  };
  if (opts.backend) {
    await writeBackendRunActionDoc(opts.backend, requestDoc);
  } else {
    const requestPath = runActionRequestPathFor(opts.recordsRoot, actionId);
    await writeControlPlaneJson(requestPath, requestDoc);
  }
  if (dedupe.mode === "reused" && submission.latestAction?.actionId === actionId) {
    const status = statusFromSubmission(submission as any);
    return runActionResponseFromSubmission(
      {
        ...status,
        latestAction: {
          ...status.latestAction!,
          dedupe: {
            ...status.latestAction!.dedupe,
            mode: "reused",
          },
          ...(opts.authorizationSnapshot
            ? { authorizationSnapshot: opts.authorizationSnapshot }
            : {}),
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
      backendDatabaseUrl: opts.backendDatabaseUrl,
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
      ...(opts.authorizationSnapshot ? { authorizationSnapshot: opts.authorizationSnapshot } : {}),
      ...(opts.approval ? { approval: opts.approval } : {}),
    });
    await writeControlPlaneJson(opts.submissionPath, approved);
    await cleanupSnapshotIfTerminal();
    const status = statusFromSubmission(approved as any);
    return runActionResponseFromSubmission(status, actionId, opts.action);
  }
  if (opts.backend && submission.lifecycleState === "paused") {
    if (opts.action === "abort") {
      throw unsupportedBackendProgressiveRunAction(opts.action);
    }
    if (opts.action === "resume" && submission.progressiveRollout?.resumable) {
      throw unsupportedBackendProgressiveRunAction(opts.action);
    }
  }
  const next = nextRunActionLifecycleState(submission.lifecycleState, opts.action);
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
      ...(opts.authorizationSnapshot ? { authorizationSnapshot: opts.authorizationSnapshot } : {}),
    });
    const status = statusFromSubmission(
      await readControlPlaneJson<SubmissionRecord>(opts.submissionPath),
    );
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
      ...(opts.authorizationSnapshot ? { authorizationSnapshot: opts.authorizationSnapshot } : {}),
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
  await cleanupSnapshotIfTerminal();
  const status = statusFromSubmission(
    await readControlPlaneJson<SubmissionRecord>(opts.submissionPath),
  );
  return runActionResponseFromSubmission(status, actionId, opts.action);
}
