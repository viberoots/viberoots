#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import {
  NIXOS_SHARED_HOST_RELEASE_ACTION_TYPES,
  releaseActionRefs,
} from "./deployment-release-actions.ts";
import type {
  DeploymentAdmissionApprovalFact,
  DeploymentAdmissionEvidence,
} from "./deployment-admission-evidence.ts";
import {
  sourceAdmissionApprovals,
  sourceAdmissionBinding,
  type DeploymentRunRecordLike,
} from "./deployment-admission-records.ts";

function isExpired(value?: string): boolean {
  if (!value) return false;
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function matchingApproval(
  name: string,
  approvals: DeploymentAdmissionApprovalFact[],
  requestedBy: string,
): DeploymentAdmissionApprovalFact | undefined {
  return approvals.find(
    (approval) =>
      approval.name === name &&
      !isExpired(approval.expiresAt) &&
      approval.approver.principalId !== requestedBy,
  );
}

function currentApprovalFacts(opts: {
  evidence?: DeploymentAdmissionEvidence;
  deploymentId: string;
  targetIdentity: string;
  payloadFingerprint: string;
  requestedBy: string;
}): DeploymentAdmissionApprovalFact[] {
  return (opts.evidence?.approvals || [])
    .filter(
      (approval) =>
        approval.status === "approved" &&
        approval.deploymentId === opts.deploymentId &&
        approval.targetIdentity === opts.targetIdentity &&
        approval.payloadFingerprint === opts.payloadFingerprint &&
        !isExpired(approval.expiresAt) &&
        approval.approver.principalId !== opts.requestedBy,
    )
    .map((approval) => ({
      name: approval.name,
      approvalId: approval.approvalId,
      approver: approval.approver,
      grantedAt: approval.grantedAt,
      ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
      status: "fresh" as const,
      ...(approval.recordRef ? { recordRef: approval.recordRef } : {}),
    }));
}

export function requireBuiltInExecutionBoundary(deployment: DeploymentTarget) {
  if (deployment.provider === "cloudflare-pages") {
    if (deployment.publisher.type !== "wrangler-pages") {
      throw new Error(
        `protected/shared admission rejects non-built-in cloudflare-pages publisher ${deployment.publisher.type}`,
      );
    }
    if (deployment.releaseActions.length > 0) {
      throw new Error(
        `protected/shared admission rejects cloudflare-pages deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
      );
    }
    return;
  }
  if (deployment.publisher.type !== "nixos-shared-host-static-webapp") {
    throw new Error(
      `protected/shared admission rejects non-built-in nixos-shared-host publisher ${deployment.publisher.type}`,
    );
  }
  if (
    deployment.provisioner?.type &&
    deployment.provisioner.type !== "nixos-shared-host-manifest"
  ) {
    throw new Error(
      `protected/shared admission rejects non-built-in nixos-shared-host provisioner ${deployment.provisioner.type}`,
    );
  }
  for (const action of deployment.releaseActions) {
    if (!NIXOS_SHARED_HOST_RELEASE_ACTION_TYPES.has(action.type)) {
      throw new Error(
        `protected/shared admission rejects non-built-in release_action ${action.ref}`,
      );
    }
  }
}

export function requiredApprovalFacts(opts: {
  deployment: DeploymentTarget;
  operationKind: "deploy" | "promotion" | "retry" | "rollback" | "preview";
  sourceRecord?: DeploymentRunRecordLike;
  evidence?: DeploymentAdmissionEvidence;
  requestedBy: string;
  binding: { payloadFingerprint: string; targetIdentity: string };
}): DeploymentAdmissionApprovalFact[] {
  if (opts.operationKind === "preview") return [];
  const fresh = currentApprovalFacts({
    evidence: opts.evidence,
    deploymentId: opts.deployment.deploymentId,
    targetIdentity: opts.binding.targetIdentity,
    payloadFingerprint: opts.binding.payloadFingerprint,
    requestedBy: opts.requestedBy,
  });
  const reused =
    opts.operationKind === "retry" &&
    opts.deployment.admissionPolicy.retryApprovalReuse === "same_lineage" &&
    sourceAdmissionBinding(opts.sourceRecord)?.payloadFingerprint ===
      opts.binding.payloadFingerprint
      ? sourceAdmissionApprovals(opts.sourceRecord).map((approval) => ({
          ...approval,
          status: "reused" as const,
        }))
      : [];
  return opts.deployment.admissionPolicy.requiredApprovals.map((name) => {
    const approval =
      matchingApproval(name, fresh, opts.requestedBy) ||
      matchingApproval(name, reused, opts.requestedBy);
    if (!approval) {
      throw new Error(
        `protected/shared admission requires approval ${name} for ${opts.deployment.deploymentId}`,
      );
    }
    return approval;
  });
}
