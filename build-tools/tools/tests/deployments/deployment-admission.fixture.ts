#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "../../deployments/contract";
import {
  createDeploymentAdmissionBinding,
  requiredCheckSubjectsFor,
  type DeploymentAdmissionOperationKind,
} from "../../deployments/deployment-admission-binding";
import type { DeploymentAdmissionEvidence } from "../../deployments/deployment-admission-evidence";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";

type EvidenceOpts = {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  sourceRevision: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  artifactLineageId?: string;
  buildInputsFingerprint?: string;
  requiredChecks?: string[];
  requiredApprovals?: string[];
  requestedBy?: string;
  approver?: string;
  approvalStatus?: "approved" | "revoked";
  expiresAt?: string;
  prerequisiteHealth?: Array<{ deploymentId: string; status?: "healthy" | "unhealthy" }>;
  provisionerPlanFingerprint?: string;
  attestationStatus?: "verified" | "expired" | "revoked" | "untrusted" | "invalid";
  signatureStatus?: "verified" | "missing" | "untrusted";
  builderIdentity?: string;
  signerIdentities?: string[];
  provenanceFormat?: string;
  sbomStatus?: "valid" | "invalid";
  sbomFormat?: string;
  supplyChainGates?: Array<{
    name: string;
    category: "vulnerability" | "license" | "other";
    applyAt: "build_admission" | "publish_admission" | "both";
    status?: "passed" | "failed";
  }>;
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
    ...(opts.buildInputsFingerprint ? { buildInputsFingerprint: opts.buildInputsFingerprint } : {}),
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
  const laneGovernanceEvidence =
    opts.deployment.protectionClass === "local_only"
      ? {}
      : reviewedLaneAdmissionEvidenceFixture({ deployment: opts.deployment });
  return {
    ...laneGovernanceEvidence,
    requestedBy: { principalId: opts.requestedBy || "user:submitter" },
    ...(requiredChecks.length > 0
      ? {
          checks: requiredChecks.map((name) => ({
            name,
            subject,
            status: "passed" as const,
            checkedAt: "2026-04-06T12:00:00.000Z",
            deploymentId: opts.deployment.deploymentId,
            environmentStage: opts.deployment.environmentStage,
            admissionPolicyRef: opts.deployment.admissionPolicyRef,
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
    ...(opts.buildInputsFingerprint ? { buildInputsFingerprint: opts.buildInputsFingerprint } : {}),
    ...(opts.deployment.admissionPolicy.attestation
      ? {
          attestations: [
            {
              builderIdentity: opts.builderIdentity || "builder:trusted",
              provenanceFormat: opts.provenanceFormat || "slsa_provenance_v1",
              artifactIdentity: opts.artifactIdentity || "artifact-123",
              sourceRevision: opts.sourceRevision,
              buildInputsFingerprint: opts.buildInputsFingerprint || "sha256:build-inputs",
              status: opts.attestationStatus || "verified",
              verifiedAt: "2026-04-06T12:03:00.000Z",
              signerIdentities: opts.signerIdentities || ["signer:trusted"],
              signatureStatus: opts.signatureStatus || "verified",
              recordRef: "attestation://artifact",
            },
          ],
        }
      : {}),
    ...(opts.deployment.admissionPolicy.sbom?.required
      ? {
          sboms: [
            {
              artifactIdentity: opts.artifactIdentity || "artifact-123",
              format: opts.sbomFormat || "cyclonedx-json",
              status: opts.sbomStatus || "valid",
              verifiedAt: "2026-04-06T12:04:00.000Z",
              recordRef: "sbom://artifact",
            },
          ],
        }
      : {}),
    ...(opts.supplyChainGates && opts.supplyChainGates.length > 0
      ? {
          supplyChainGates: opts.supplyChainGates.map((gate) => ({
            name: gate.name,
            category: gate.category,
            applyAt: gate.applyAt,
            status: gate.status || "passed",
            evaluatedAt: "2026-04-06T12:05:00.000Z",
            recordRef: `gate://${gate.name}/${gate.applyAt}`,
          })),
        }
      : {}),
  };
}
