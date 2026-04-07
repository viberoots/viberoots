#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "../../deployments/contract.ts";
import {
  createDeploymentAdmissionBinding,
  requiredCheckSubjectsFor,
  type DeploymentAdmissionOperationKind,
} from "../../deployments/deployment-admission-binding.ts";
import type { DeploymentAdmissionEvidence } from "../../deployments/deployment-admission-evidence.ts";

type EvidenceOpts = {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  sourceRevision: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  artifactLineageId?: string;
  requiredChecks?: string[];
  requiredApprovals?: string[];
  requestedBy?: string;
  approver?: string;
  approvalStatus?: "approved" | "revoked";
  expiresAt?: string;
  prerequisiteHealth?: Array<{ deploymentId: string; status?: "healthy" | "unhealthy" }>;
  provisionerPlanFingerprint?: string;
};

export function admissionBindingFixture(opts: EvidenceOpts) {
  return createDeploymentAdmissionBinding({
    deployment: opts.deployment,
    sourceRevision: opts.sourceRevision,
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
    ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
    ...(opts.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: opts.provisionerPlanFingerprint }
      : {}),
  });
}

export function deploymentAdmissionEvidenceFixture(
  opts: EvidenceOpts,
): DeploymentAdmissionEvidence {
  const binding = admissionBindingFixture(opts);
  const subject = requiredCheckSubjectsFor(opts.operationKind, binding)[0] || opts.sourceRevision;
  const requiredChecks = opts.requiredChecks || opts.deployment.admissionPolicy.requiredChecks;
  const requiredApprovals =
    opts.requiredApprovals || opts.deployment.admissionPolicy.requiredApprovals;
  return {
    requestedBy: { principalId: opts.requestedBy || "user:submitter" },
    ...(requiredChecks.length > 0
      ? {
          checks: requiredChecks.map((name) => ({
            name,
            subject,
            status: "passed" as const,
            checkedAt: "2026-04-06T12:00:00.000Z",
            recordRef: `check://${name}`,
          })),
        }
      : {}),
    ...(requiredApprovals.length > 0
      ? {
          approvals: requiredApprovals.map((name) => ({
            name,
            approvalId: `${name}-approval`,
            status: opts.approvalStatus || ("approved" as const),
            approver: { principalId: opts.approver || "user:approver" },
            grantedAt: "2026-04-06T12:01:00.000Z",
            ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
            payloadFingerprint: binding.payloadFingerprint,
            deploymentId: opts.deployment.deploymentId,
            targetIdentity: binding.targetIdentity,
            recordRef: `approval://${name}`,
          })),
        }
      : {}),
    ...(opts.prerequisiteHealth && opts.prerequisiteHealth.length > 0
      ? {
          prerequisiteHealth: opts.prerequisiteHealth.map((entry) => ({
            deploymentId: entry.deploymentId,
            status: entry.status || "healthy",
            checkedAt: "2026-04-06T12:02:00.000Z",
            evidenceRef: `health://${entry.deploymentId}`,
          })),
        }
      : {}),
    ...(opts.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: opts.provisionerPlanFingerprint }
      : {}),
  };
}
