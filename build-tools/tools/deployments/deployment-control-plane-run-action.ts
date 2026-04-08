#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
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
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume";
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
      | "cancelling"
      | "finished"
      | "cancelled";
    rejectionCode?:
      | "lock_conflict"
      | "approval_required"
      | "approval_no_longer_valid"
      | "idempotency_conflict"
      | "unauthorized"
      | "no_longer_admitted"
      | "not_resumable";
  };
};

function nextLifecycleState(
  lifecycleState: SubmissionRecord["lifecycleState"],
  action: DeploymentControlPlaneRunAction,
) {
  if (action === "resume") return { lifecycleState, rejectionCode: "not_resumable" as const };
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
}) {
  const submission = await readControlPlaneJson<SubmissionRecord>(opts.submissionPath);
  const submittedAt = new Date().toISOString();
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
      ...(next.rejectionCode ? { rejectionCode: next.rejectionCode } : {}),
    },
  };
  await writeControlPlaneJson(opts.submissionPath, updated);
  const status = await readDeploymentControlPlaneStatus({
    submissionPath: opts.submissionPath,
  });
  return runActionResponseFromSubmission(status, actionId, opts.action);
}
