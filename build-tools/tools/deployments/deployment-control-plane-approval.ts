#!/usr/bin/env zx-wrapper
import path from "node:path";
import { createDeploymentAdmissionBinding } from "./deployment-admission-binding";
import type {
  DeploymentAdmissionEvidence,
  DeploymentPrincipal,
} from "./deployment-admission-evidence";
import type { DeploymentControlPlaneApprovalSummary } from "./deployment-control-plane-contract";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";

export const DEPLOYMENT_CONTROL_PLANE_APPROVAL_GRANT_SCHEMA =
  "deployment-control-plane-approval-grant@1";

type SnapshotLike = {
  deploymentId: string;
  deployment: any;
  action?: { artifactLineageId?: string };
  admittedContext?: {
    source?: {
      sourceRevision?: string;
      sourceRunId?: string;
      artifactIdentity?: string;
    };
  };
  provisionerPlan?: { fingerprint?: string };
};

export type DeploymentControlPlaneApprovalGrantRecord = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_APPROVAL_GRANT_SCHEMA;
  approvalId: string;
  submissionId: string;
  deployRunId: string;
  executionSnapshotPath: string;
  grantedAt: string;
  approvalNames: string[];
  approver: DeploymentPrincipal;
  deploymentId: string;
  status: "approved" | "revoked";
  payloadFingerprint: string;
  targetIdentity: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  provisionerPlanFingerprint?: string;
  expiresAt?: string;
};

function bindingForSnapshot(snapshot: SnapshotLike) {
  if (!snapshot.admittedContext) {
    throw new Error("approval binding requires an admitted control-plane snapshot");
  }
  return createDeploymentAdmissionBinding({
    deployment: snapshot.deployment,
    sourceRevision: snapshot.admittedContext.source?.sourceRevision,
    sourceRunId: snapshot.admittedContext.source?.sourceRunId,
    artifactIdentity: snapshot.admittedContext.source?.artifactIdentity,
    artifactLineageId: snapshot.action?.artifactLineageId,
    provisionerPlanFingerprint: snapshot.provisionerPlan?.fingerprint,
  });
}

function optionalSummaryFields(record: {
  sourceRunId?: string;
  artifactIdentity?: string;
  provisionerPlanFingerprint?: string;
}) {
  return {
    ...(record.sourceRunId ? { sourceRunId: record.sourceRunId } : {}),
    ...(record.artifactIdentity ? { artifactIdentity: record.artifactIdentity } : {}),
    ...(record.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: record.provisionerPlanFingerprint }
      : {}),
  };
}

export function approvalGrantPathFor(recordsRoot: string, approvalId: string): string {
  return path.join(path.resolve(recordsRoot), "control-plane", "approvals", `${approvalId}.json`);
}

export function pendingApprovalSummaryFor(opts: {
  snapshot: SnapshotLike;
  approvalNames: string[];
}): DeploymentControlPlaneApprovalSummary {
  const binding = bindingForSnapshot(opts.snapshot);
  return {
    state: "pending",
    approvalNames: opts.approvalNames,
    payloadFingerprint: binding.payloadFingerprint,
    targetIdentity: binding.targetIdentity,
    ...optionalSummaryFields(binding),
  };
}

export function approvalSummaryFromGrant(
  record: DeploymentControlPlaneApprovalGrantRecord,
  state: DeploymentControlPlaneApprovalSummary["state"] = "granted",
): DeploymentControlPlaneApprovalSummary {
  return {
    state,
    approvalNames: record.approvalNames,
    payloadFingerprint: record.payloadFingerprint,
    targetIdentity: record.targetIdentity,
    grantedAt: record.grantedAt,
    approvalId: record.approvalId,
    approver: record.approver,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...optionalSummaryFields(record),
  };
}

export function approvalGrantRecordFor(opts: {
  approvalId: string;
  submissionId: string;
  deployRunId: string;
  executionSnapshotPath: string;
  grantedAt: string;
  approver: DeploymentPrincipal;
  approvalNames: string[];
  snapshot: SnapshotLike;
  summary?: DeploymentControlPlaneApprovalSummary;
  expiresAt?: string;
}): DeploymentControlPlaneApprovalGrantRecord {
  const binding = opts.summary
    ? {
        payloadFingerprint: opts.summary.payloadFingerprint,
        targetIdentity: opts.summary.targetIdentity,
        sourceRunId: opts.summary.sourceRunId,
        artifactIdentity: opts.summary.artifactIdentity,
        provisionerPlanFingerprint: opts.summary.provisionerPlanFingerprint,
      }
    : bindingForSnapshot(opts.snapshot);
  return {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_APPROVAL_GRANT_SCHEMA,
    approvalId: opts.approvalId,
    submissionId: opts.submissionId,
    deployRunId: opts.deployRunId,
    executionSnapshotPath: opts.executionSnapshotPath,
    grantedAt: opts.grantedAt,
    approvalNames: opts.approvalNames,
    approver: opts.approver,
    deploymentId: opts.snapshot.deploymentId,
    status: "approved",
    payloadFingerprint: binding.payloadFingerprint,
    targetIdentity: binding.targetIdentity,
    ...(binding.sourceRunId ? { sourceRunId: binding.sourceRunId } : {}),
    ...(binding.artifactIdentity ? { artifactIdentity: binding.artifactIdentity } : {}),
    ...(binding.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: binding.provisionerPlanFingerprint }
      : {}),
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  };
}

export function approvalEvidenceFromGrant(opts: {
  requestedBy?: DeploymentPrincipal;
  record: DeploymentControlPlaneApprovalGrantRecord;
  approvalRecordPath: string;
}): DeploymentAdmissionEvidence {
  return {
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    approvals: opts.record.approvalNames.map((name) => ({
      name,
      approvalId: `${opts.record.approvalId}:${name}`,
      status: "approved" as const,
      approver: opts.record.approver,
      grantedAt: opts.record.grantedAt,
      payloadFingerprint: opts.record.payloadFingerprint,
      deploymentId: opts.record.deploymentId,
      targetIdentity: opts.record.targetIdentity,
      recordRef: opts.approvalRecordPath,
      ...(opts.record.expiresAt ? { expiresAt: opts.record.expiresAt } : {}),
    })),
  };
}

export async function writeApprovalGrantRecord(
  approvalRecordPath: string,
  record: DeploymentControlPlaneApprovalGrantRecord,
) {
  await writeControlPlaneJson(approvalRecordPath, record);
}

export async function readApprovalGrantRecord(approvalRecordPath: string) {
  return await readControlPlaneJson<DeploymentControlPlaneApprovalGrantRecord>(
    path.resolve(approvalRecordPath),
  );
}

export function approvalGrantIsValid(opts: {
  record: DeploymentControlPlaneApprovalGrantRecord;
  summary: DeploymentControlPlaneApprovalSummary;
}) {
  const now = Date.now();
  return (
    opts.record.status === "approved" &&
    opts.record.payloadFingerprint === opts.summary.payloadFingerprint &&
    opts.record.targetIdentity === opts.summary.targetIdentity &&
    (!opts.record.expiresAt || Date.parse(opts.record.expiresAt) > now) &&
    (!opts.summary.provisionerPlanFingerprint ||
      opts.record.provisionerPlanFingerprint === opts.summary.provisionerPlanFingerprint)
  );
}
