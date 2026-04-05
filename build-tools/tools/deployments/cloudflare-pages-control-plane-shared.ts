#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesControlPlaneSubmission,
} from "./cloudflare-pages-control-plane-contract.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";

export function createCloudflarePagesSubmissionId(): string {
  return `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function createWorkerId(submissionId: string): string {
  return `${submissionId}-worker`;
}

function admissionReasonFor(
  deployment: CloudflarePagesDeployment,
): "shared_nonprod" | "production_facing" {
  return deployment.protectionClass === "production_facing"
    ? "production_facing"
    : "shared_nonprod";
}

export async function withCloudflarePagesControlPlaneRun(
  deployment: CloudflarePagesDeployment,
  recordsRoot: string,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  execute: (authority: {
    kind: "control-plane-worker";
    submissionId: string;
    submissionPath: string;
    workerId: string;
    lockScope: string;
    executionSnapshotPath: string;
  }) => Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }>,
) {
  const executionSnapshotPath = executionSnapshotPathFor(recordsRoot, snapshot.submissionId);
  const submissionPath = submissionPathFor(recordsRoot, snapshot.submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLock(recordsRoot, snapshot.lockScope);
  } catch (error) {
    const rejected: CloudflarePagesControlPlaneSubmission = {
      schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
      submissionId: snapshot.submissionId,
      submittedAt: snapshot.submittedAt,
      operationKind: snapshot.operationKind,
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: snapshot.providerTargetIdentity,
      lockScope: snapshot.lockScope,
      executionSnapshotPath,
      admission: { decision: "rejected", reason: "lock_conflict" },
    };
    await writeControlPlaneJson(submissionPath, rejected);
    throw error;
  }
  let submission: CloudflarePagesControlPlaneSubmission = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId: snapshot.submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    executionSnapshotPath,
    workerId: createWorkerId(snapshot.submissionId),
    admission: { decision: "admitted", reason: admissionReasonFor(deployment) },
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    const result = await execute({
      kind: "control-plane-worker",
      submissionId: snapshot.submissionId,
      submissionPath,
      workerId: submission.workerId || createWorkerId(snapshot.submissionId),
      lockScope: snapshot.lockScope,
      executionSnapshotPath,
    });
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
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
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.finalOutcome
        ? { finalOutcome: (error as any).record.finalOutcome }
        : {}),
    };
    await writeControlPlaneJson(submissionPath, submission);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { submission });
  } finally {
    await releaseLock?.();
  }
}
