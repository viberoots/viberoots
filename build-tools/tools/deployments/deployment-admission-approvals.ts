#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import { destructiveReleaseActions, releaseActionRefs } from "./deployment-release-actions.ts";
import { providerDeclaresReleaseActionType } from "./deployment-provider-capabilities.ts";
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
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in cloudflare-pages publisher ${deployment.publisher.type}`,
      );
    }
    if (deployment.releaseActions.length > 0) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects cloudflare-pages deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
      );
    }
    return;
  }
  if (deployment.provider === "s3-static") {
    if (deployment.publisher.type !== "aws-s3-sync") {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in s3-static publisher ${deployment.publisher.type}`,
      );
    }
    if (
      deployment.provisioner?.type &&
      !["terraform-stack", "cdktf-stack"].includes(deployment.provisioner.type)
    ) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in s3-static provisioner ${deployment.provisioner.type}`,
      );
    }
    if (deployment.releaseActions.length > 0) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects s3-static deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
      );
    }
    return;
  }
  if (deployment.provider === "app-store-connect") {
    if (deployment.publisher.type !== "app-store-connect-mobile-release") {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in app-store-connect publisher ${deployment.publisher.type}`,
      );
    }
    if (deployment.releaseActions.length > 0) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects app-store-connect deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
      );
    }
    return;
  }
  if (deployment.provider === "google-play") {
    if (deployment.publisher.type !== "google-play-mobile-release") {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in google-play publisher ${deployment.publisher.type}`,
      );
    }
    if (deployment.releaseActions.length > 0) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects google-play deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
      );
    }
    return;
  }
  if (
    deployment.publisher.type !== "nixos-shared-host-static-webapp" &&
    deployment.publisher.type !== "nixos-shared-host-ssr-webapp"
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared admission rejects non-built-in nixos-shared-host publisher ${deployment.publisher.type}`,
    );
  }
  if (
    deployment.provisioner?.type &&
    deployment.provisioner.type !== "nixos-shared-host-manifest"
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared admission rejects non-built-in nixos-shared-host provisioner ${deployment.provisioner.type}`,
    );
  }
  for (const action of deployment.releaseActions) {
    if (!providerDeclaresReleaseActionType("nixos-shared-host", action.type)) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission rejects non-built-in release_action ${action.ref}`,
      );
    }
  }
  const destructiveActions = destructiveReleaseActions(deployment.releaseActions);
  if (destructiveActions.length > 0) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared routine deploy rejects destructive built-in release_actions: ${releaseActionRefs(destructiveActions).join(", ")}`,
    );
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
  const providedApprovals = opts.evidence?.approvals || [];
  const sawProvidedApproval = providedApprovals.some(
    (approval) =>
      approval.name &&
      approval.deploymentId === opts.deployment.deploymentId &&
      approval.targetIdentity === opts.binding.targetIdentity,
  );
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
      throw new DeploymentAdmissionError(
        sawProvidedApproval ? "approval_no_longer_valid" : "approval_required",
        `protected/shared admission requires approval ${name} for ${opts.deployment.deploymentId}`,
      );
    }
    return approval;
  });
}
