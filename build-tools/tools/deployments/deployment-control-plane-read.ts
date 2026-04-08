#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentControlPlaneAuthorizationDecision } from "./deployment-control-plane-contract.ts";
import { statusFromSubmission } from "./deployment-control-plane-status.ts";
import {
  readControlPlaneJson,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store.ts";

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
  completedAt?: string;
  workerId?: string;
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  rejectionCode?:
    | "lock_conflict"
    | "approval_required"
    | "approval_no_longer_valid"
    | "idempotency_conflict"
    | "unauthorized"
    | "no_longer_admitted"
    | "not_resumable";
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
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

async function submissionPathFromRecord(recordPath: string): Promise<string> {
  const record = JSON.parse(await fsp.readFile(recordPath, "utf8")) as {
    controlPlane?: { submissionPath?: string };
  };
  const submissionPath = record.controlPlane?.submissionPath;
  if (!submissionPath) {
    throw new Error(`deploy record is missing controlPlane.submissionPath: ${recordPath}`);
  }
  return path.resolve(submissionPath);
}

async function resolveSubmissionPath(opts: {
  recordsRoot?: string;
  submissionId?: string;
  submissionPath?: string;
  recordPath?: string;
  deployRunId?: string;
}): Promise<string> {
  if (opts.submissionPath) return path.resolve(opts.submissionPath);
  if (opts.recordPath) return await submissionPathFromRecord(path.resolve(opts.recordPath));
  if (opts.recordsRoot && opts.deployRunId) {
    return await submissionPathFromRecord(
      path.join(path.resolve(opts.recordsRoot), "runs", `${opts.deployRunId}.json`),
    );
  }
  if (opts.recordsRoot && opts.submissionId) {
    return submissionPathFor(opts.recordsRoot, opts.submissionId);
  }
  throw new Error(
    "status lookup requires --submission-path, --record-path, --records-root with --submission-id, or --records-root with --deploy-run-id",
  );
}

export async function readDeploymentControlPlaneStatus(opts: {
  recordsRoot?: string;
  submissionId?: string;
  submissionPath?: string;
  recordPath?: string;
  deployRunId?: string;
}) {
  const filePath = await resolveSubmissionPath(opts);
  const submission = await readControlPlaneJson<SubmissionRecord>(filePath);
  return statusFromSubmission(submission);
}
