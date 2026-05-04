#!/usr/bin/env zx-wrapper
import path from "node:path";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneServiceInstance,
} from "./deployment-control-plane-contract";
import { statusFromSubmission } from "./deployment-control-plane-status";
import {
  readBackendSubmissionByDeployRunId,
  readBackendSubmissionBySubmissionId,
} from "./nixos-shared-host-control-plane-backend";

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
  completedAt?: string;
  workerId?: string;
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  rejectionCode?:
    | "lock_conflict"
    | "approval_required"
    | "approval_no_longer_valid"
    | "idempotency_conflict"
    | "unauthorized"
    | "no_longer_admitted"
    | "not_resumable";
  rejectionMessage?: string;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  approval?: {
    state: "pending" | "granted" | "no_longer_valid";
    approvalNames: string[];
    payloadFingerprint: string;
    targetIdentity: string;
    sourceRunId?: string;
    artifactIdentity?: string;
    provisionerPlanFingerprint?: string;
    grantedAt?: string;
    expiresAt?: string;
    approvalId?: string;
    approver?: { principalId: string; displayName?: string };
  };
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume" | "abort" | "approve";
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
    authorizationSnapshot?: DeploymentControlPlaneAuthorization;
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

export async function readDeploymentControlPlaneStatus(opts: {
  backendDatabaseUrl?: string;
  recordsRoot?: string;
  submissionId?: string;
  submissionPath?: string;
  deployRunId?: string;
}) {
  if (opts.submissionPath) {
    throw new Error(
      "status lookup no longer accepts --submission-path; use backend-native --submission-id/--deploy-run-id with --control-plane-database-url",
    );
  }
  if (opts.backendDatabaseUrl && (opts.submissionId || opts.deployRunId)) {
    const backend = {
      recordsRoot: path.resolve(opts.recordsRoot || process.cwd()),
      databaseUrl: opts.backendDatabaseUrl,
    };
    const submission = opts.submissionId
      ? await readBackendSubmissionBySubmissionId(backend, opts.submissionId)
      : await readBackendSubmissionByDeployRunId(backend, String(opts.deployRunId));
    if (!submission) {
      throw Object.assign(new Error("submission not found"), { code: "ENOENT" });
    }
    return statusFromSubmission(submission as SubmissionRecord);
  }
  throw new Error(
    "status lookup requires backend-native --submission-id/--deploy-run-id with --control-plane-database-url",
  );
}
