#!/usr/bin/env zx-wrapper
import { evaluateNixosSharedHostControlPlaneAdmission } from "./nixos-shared-host-control-plane-admission.ts";
import { queueSubmissionForLock } from "./deployment-control-plane-queue.ts";
import type {
  DeploymentControlPlaneApprovalGrantRequest,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import type {
  DeploymentAdmissionEvidence,
  DeploymentPrincipal,
} from "./deployment-admission-evidence.ts";
import { approvalSourceSelection } from "./deployment-control-plane-approve-source.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import {
  approvalEvidenceFromGrant,
  approvalGrantPathFor,
  approvalGrantRecordFor,
  approvalSummaryFromGrant,
  pendingApprovalSummaryFor,
  writeApprovalGrantRecord,
} from "./deployment-control-plane-approval.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";

type SubmissionLike = {
  submissionId: string;
  deployRunId?: string;
  executionSnapshotPath: string;
  lifecycleState: string;
  admission: { decision: string; reason: string };
  requestedBy?: DeploymentPrincipal;
  approval?: {
    state: "pending" | "granted" | "no_longer_valid";
    approvalNames: string[];
    payloadFingerprint: string;
    targetIdentity: string;
    provisionerPlanFingerprint?: string;
  };
  latestAction?: unknown;
};

type SnapshotLike = {
  deploymentId: string;
  deployment: any;
  operationKind: "deploy" | "promotion" | "retry" | "rollback" | "preview";
  provisionerPlan?: { fingerprint?: string };
  admittedContext?: any;
  admissionEvidence?: DeploymentAdmissionEvidence;
  action?: {
    artifactLineageId?: string;
    parentRunId?: string;
    sourceReplaySnapshotPath?: string;
  };
  paths: { recordsRoot: string };
};

function mergeAdmissionEvidence(
  base: DeploymentAdmissionEvidence | undefined,
  overlay: DeploymentAdmissionEvidence,
): DeploymentAdmissionEvidence {
  const checks = [...(base?.checks || []), ...(overlay.checks || [])];
  const approvals = [...(base?.approvals || []), ...(overlay.approvals || [])];
  const prerequisiteHealth = [
    ...(base?.prerequisiteHealth || []),
    ...(overlay.prerequisiteHealth || []),
  ];
  const attestations = [...(base?.attestations || []), ...(overlay.attestations || [])];
  const sboms = [...(base?.sboms || []), ...(overlay.sboms || [])];
  const supplyChainGates = [...(base?.supplyChainGates || []), ...(overlay.supplyChainGates || [])];
  return {
    ...(base || {}),
    ...overlay,
    ...(checks.length > 0 ? { checks } : {}),
    ...(approvals.length > 0 ? { approvals } : {}),
    ...(prerequisiteHealth.length > 0 ? { prerequisiteHealth } : {}),
    ...(attestations.length > 0 ? { attestations } : {}),
    ...(sboms.length > 0 ? { sboms } : {}),
    ...(supplyChainGates.length > 0 ? { supplyChainGates } : {}),
  };
}

function normalizedApprovalNames(
  requested: string[] | undefined,
  required: string[],
): string[] | null {
  const names = Array.from(
    new Set((requested || required).map((entry) => entry.trim()).filter(Boolean)),
  );
  return names.length === required.length && required.every((entry) => names.includes(entry))
    ? names
    : null;
}

function rejection(opts: {
  submission: SubmissionLike;
  actionId: string;
  submittedAt: string;
  requestedBy: DeploymentPrincipal;
  dedupe: DeploymentControlPlaneRequestDedupe;
  rejectionCode:
    | "approval_required"
    | "approval_no_longer_valid"
    | "unauthorized"
    | "no_longer_admitted";
}) {
  return {
    ...opts.submission,
    latestAction: {
      actionId: opts.actionId,
      action: "approve" as const,
      submittedAt: opts.submittedAt,
      dedupe: opts.dedupe,
      lifecycleState: opts.submission.lifecycleState,
      requestedBy: opts.requestedBy,
      rejectionCode: opts.rejectionCode,
    },
  };
}

export async function approvePendingSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  submissionPath: string;
  submission: SubmissionLike;
  actionId: string;
  submittedAt: string;
  requestedBy: DeploymentPrincipal;
  dedupe: DeploymentControlPlaneRequestDedupe;
  approval?: DeploymentControlPlaneApprovalGrantRequest;
}) {
  if (opts.submission.lifecycleState !== "pending_approval" || !opts.submission.deployRunId) {
    return rejection({ ...opts, rejectionCode: "no_longer_admitted" });
  }
  if (opts.submission.requestedBy?.principalId === opts.requestedBy.principalId) {
    return rejection({ ...opts, rejectionCode: "unauthorized" });
  }
  const snapshot = await readControlPlaneJson<SnapshotLike>(opts.submission.executionSnapshotPath);
  const required = snapshot.deployment.admissionPolicy.requiredApprovals;
  const pending =
    opts.submission.approval || pendingApprovalSummaryFor({ snapshot, approvalNames: required });
  const approvalNames = normalizedApprovalNames(opts.approval?.approvalNames, required);
  if (!approvalNames) {
    return rejection({ ...opts, rejectionCode: "approval_required" });
  }
  if (
    (opts.approval?.expectedPayloadFingerprint &&
      opts.approval.expectedPayloadFingerprint !== pending.payloadFingerprint) ||
    (opts.approval?.expectedTargetIdentity &&
      opts.approval.expectedTargetIdentity !== pending.targetIdentity) ||
    (opts.approval?.expectedProvisionerPlanFingerprint &&
      opts.approval.expectedProvisionerPlanFingerprint !== pending.provisionerPlanFingerprint)
  ) {
    return rejection({ ...opts, rejectionCode: "approval_no_longer_valid" });
  }
  const approvalId = opts.approval?.approvalId?.trim() || `approval-${opts.actionId}`;
  const approvalRecordPath = approvalGrantPathFor(opts.recordsRoot, approvalId);
  const grant = approvalGrantRecordFor({
    approvalId,
    submissionId: opts.submission.submissionId,
    deployRunId: opts.submission.deployRunId,
    executionSnapshotPath: opts.submission.executionSnapshotPath,
    grantedAt: opts.submittedAt,
    approver: opts.requestedBy,
    approvalNames,
    snapshot,
    summary: pending,
    ...(opts.approval?.expiresAt ? { expiresAt: opts.approval.expiresAt } : {}),
  });
  const source = await approvalSourceSelection({
    workspaceRoot: opts.workspaceRoot,
    snapshot,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  const admissionEvidence = mergeAdmissionEvidence(
    snapshot.admissionEvidence,
    approvalEvidenceFromGrant({
      requestedBy: opts.submission.requestedBy,
      record: grant,
      approvalRecordPath,
    }),
  );
  try {
    await evaluateNixosSharedHostControlPlaneAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      deployment: snapshot.deployment,
      snapshot,
      ...(snapshot.action?.artifactLineageId
        ? { artifactLineageId: snapshot.action.artifactLineageId }
        : {}),
      ...(source ? { source } : {}),
      admissionEvidence,
    });
    await writeControlPlaneJson(opts.submission.executionSnapshotPath, snapshot);
    await writeApprovalGrantRecord(approvalRecordPath, grant);
  } catch (error) {
    if (
      error instanceof DeploymentAdmissionError &&
      (error.code === "approval_required" ||
        error.code === "approval_no_longer_valid" ||
        error.code === "no_longer_admitted")
    ) {
      return rejection({
        ...opts,
        rejectionCode: error.code === "no_longer_admitted" ? "no_longer_admitted" : error.code,
      });
    }
    throw error;
  }
  const approved = {
    ...opts.submission,
    admission: { decision: "admitted" as const, reason: "shared_nonprod" as const },
    lifecycleState: "queued" as const,
    terminationReason: null,
    approval: approvalSummaryFromGrant(grant, approvalRecordPath),
    latestAction: {
      actionId: opts.actionId,
      action: "approve" as const,
      submittedAt: opts.submittedAt,
      dedupe: opts.dedupe,
      lifecycleState: "queued" as const,
      requestedBy: opts.requestedBy,
    },
  };
  return await queueSubmissionForLock({
    recordsRoot: opts.recordsRoot,
    submissionPath: opts.submissionPath,
    snapshot,
    submission: approved,
  });
}
