#!/usr/bin/env zx-wrapper
import type { DeploymentPrerequisiteMode } from "./contract-types";
import {
  type DeploymentAdmissionCheckFact,
  type DeploymentCheckEvidence,
} from "./deployment-admission-checks";
import { type DeploymentLaneGovernanceFact } from "./deployment-admission-governance";
import {
  type DeploymentAttestationEvidence,
  type DeploymentAttestationFact,
  type DeploymentSbomEvidence,
  type DeploymentSbomFact,
  type DeploymentSupplyChainGateEvidence,
  type DeploymentSupplyChainGateFact,
} from "./deployment-admission-supply-chain";
import type {
  DeploymentReadinessGateEvidence,
  DeploymentReadinessGateFact,
} from "./deployment-readiness-gates";
export { normalizeAdmissionEvidence } from "./deployment-admission-evidence-normalize";

export type {
  DeploymentAdmissionCheckFact,
  DeploymentCheckEvidence,
  DeploymentCheckReportingKind,
} from "./deployment-admission-checks";

export type DeploymentPrincipal = {
  principalId: string;
  displayName?: string;
};

export type DeploymentApprovalEvidence = {
  name: string;
  approvalId: string;
  status: "approved" | "revoked";
  approver: DeploymentPrincipal;
  grantedAt: string;
  expiresAt?: string;
  payloadFingerprint: string;
  deploymentId: string;
  targetIdentity: string;
  recordRef?: string;
};

export type DeploymentHealthEvidence = {
  deploymentId: string;
  status: "healthy" | "unhealthy";
  checkedAt: string;
  evidenceRef?: string;
};

export type DeploymentAdmissionEvidence = {
  requestedBy?: DeploymentPrincipal;
  submittedBy?: DeploymentPrincipal;
  checks?: DeploymentCheckEvidence[];
  approvals?: DeploymentApprovalEvidence[];
  prerequisiteHealth?: DeploymentHealthEvidence[];
  laneGovernance?: DeploymentLaneGovernanceFact;
  provisionerPlanFingerprint?: string;
  buildInputsFingerprint?: string;
  attestations?: DeploymentAttestationEvidence[];
  sboms?: DeploymentSbomEvidence[];
  supplyChainGates?: DeploymentSupplyChainGateEvidence[];
  readinessGates?: DeploymentReadinessGateEvidence[];
};

export type DeploymentAdmissionBinding = {
  payloadFingerprint: string;
  targetIdentity: string;
  sourceRevision?: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  artifactLineageId?: string;
  provisionerPlanFingerprint?: string;
  buildInputsFingerprint?: string;
};

export type DeploymentAdmissionApprovalFact = {
  name: string;
  approvalId: string;
  approver: DeploymentPrincipal;
  grantedAt: string;
  expiresAt?: string;
  status: "fresh" | "reused";
  recordRef?: string;
};

export type DeploymentPrerequisiteFact = {
  deploymentId: string;
  mode: DeploymentPrerequisiteMode;
  sourceDeployRunId: string;
  publicUrl?: string;
  healthUrl?: string;
  checkedAt?: string;
  healthEvidenceRef?: string;
};

export type DeploymentAdmissionPolicyEvaluation = {
  evaluatedAt: string;
  requestedBy: DeploymentPrincipal;
  submittedBy?: DeploymentPrincipal;
  binding: DeploymentAdmissionBinding;
  requiredChecks: DeploymentAdmissionCheckFact[];
  requiredApprovals: DeploymentAdmissionApprovalFact[];
  prerequisites: DeploymentPrerequisiteFact[];
  laneGovernance?: DeploymentLaneGovernanceFact;
  attestation?: DeploymentAttestationFact;
  sbom?: DeploymentSbomFact;
  supplyChainGates: DeploymentSupplyChainGateFact[];
  readinessGates: DeploymentReadinessGateFact[];
};

export function defaultRequestedBy(): DeploymentPrincipal {
  return { principalId: "local:anonymous" };
}
