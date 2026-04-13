#!/usr/bin/env zx-wrapper
import type { DeploymentPrerequisiteMode } from "./contract-types.ts";
import {
  normalizeLaneGovernanceEvidence,
  type DeploymentLaneGovernanceFact,
} from "./deployment-admission-governance.ts";
import {
  normalizeAttestationEvidence,
  normalizeSbomEvidence,
  normalizeSupplyChainGateEvidence,
  type DeploymentAttestationEvidence,
  type DeploymentAttestationFact,
  type DeploymentSbomEvidence,
  type DeploymentSbomFact,
  type DeploymentSupplyChainGateEvidence,
  type DeploymentSupplyChainGateFact,
} from "./deployment-admission-supply-chain.ts";

export type DeploymentPrincipal = {
  principalId: string;
  displayName?: string;
};

export type DeploymentCheckEvidence = {
  name: string;
  subject: string;
  status: "passed" | "failed";
  checkedAt: string;
  recordRef?: string;
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

export type DeploymentAdmissionCheckFact = {
  name: string;
  subject: string;
  checkedAt: string;
  recordRef?: string;
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
  sourceRecordPath?: string;
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
};

function normalizePrincipal(value: unknown): DeploymentPrincipal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const principalId =
    typeof (value as { principalId?: unknown }).principalId === "string"
      ? String((value as { principalId: string }).principalId).trim()
      : "";
  if (!principalId) return undefined;
  const displayName =
    typeof (value as { displayName?: unknown }).displayName === "string"
      ? String((value as { displayName: string }).displayName).trim()
      : "";
  return displayName ? { principalId, displayName } : { principalId };
}

function normalizeList<T>(value: unknown, map: (entry: unknown) => T | undefined): T[] {
  return Array.isArray(value) ? value.map(map).filter((entry): entry is T => !!entry) : [];
}

export function defaultRequestedBy(): DeploymentPrincipal {
  return { principalId: "local:anonymous" };
}

export function normalizeAdmissionEvidence(
  value: unknown,
): DeploymentAdmissionEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const checks = normalizeList(raw.checks, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const subject = typeof entry.subject === "string" ? entry.subject.trim() : "";
    const status = entry.status === "failed" ? "failed" : entry.status === "passed" ? "passed" : "";
    const checkedAt = typeof entry.checkedAt === "string" ? entry.checkedAt.trim() : "";
    if (!name || !subject || !status || !checkedAt) return undefined;
    const recordRef = typeof entry.recordRef === "string" ? entry.recordRef.trim() : "";
    return recordRef
      ? { name, subject, status, checkedAt, recordRef }
      : { name, subject, status, checkedAt };
  });
  const approvals = normalizeList(raw.approvals, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const approvalId = typeof entry.approvalId === "string" ? entry.approvalId.trim() : "";
    const status =
      entry.status === "approved" ? "approved" : entry.status === "revoked" ? "revoked" : "";
    const grantedAt = typeof entry.grantedAt === "string" ? entry.grantedAt.trim() : "";
    const payloadFingerprint =
      typeof entry.payloadFingerprint === "string" ? entry.payloadFingerprint.trim() : "";
    const deploymentId = typeof entry.deploymentId === "string" ? entry.deploymentId.trim() : "";
    const targetIdentity =
      typeof entry.targetIdentity === "string" ? entry.targetIdentity.trim() : "";
    const approver = normalizePrincipal(entry.approver);
    if (
      !name ||
      !approvalId ||
      !status ||
      !grantedAt ||
      !payloadFingerprint ||
      !deploymentId ||
      !targetIdentity ||
      !approver
    ) {
      return undefined;
    }
    const expiresAt = typeof entry.expiresAt === "string" ? entry.expiresAt.trim() : "";
    const recordRef = typeof entry.recordRef === "string" ? entry.recordRef.trim() : "";
    return {
      name,
      approvalId,
      status,
      approver,
      grantedAt,
      payloadFingerprint,
      deploymentId,
      targetIdentity,
      ...(expiresAt ? { expiresAt } : {}),
      ...(recordRef ? { recordRef } : {}),
    };
  });
  const prerequisiteHealth = normalizeList(raw.prerequisiteHealth, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const deploymentId = typeof entry.deploymentId === "string" ? entry.deploymentId.trim() : "";
    const status =
      entry.status === "healthy" ? "healthy" : entry.status === "unhealthy" ? "unhealthy" : "";
    const checkedAt = typeof entry.checkedAt === "string" ? entry.checkedAt.trim() : "";
    if (!deploymentId || !status || !checkedAt) return undefined;
    const evidenceRef = typeof entry.evidenceRef === "string" ? entry.evidenceRef.trim() : "";
    return evidenceRef
      ? { deploymentId, status, checkedAt, evidenceRef }
      : { deploymentId, status, checkedAt };
  });
  const requestedBy = normalizePrincipal(raw.requestedBy);
  const submittedBy = normalizePrincipal(raw.submittedBy);
  const laneGovernance = normalizeLaneGovernanceEvidence(raw.laneGovernance);
  const provisionerPlanFingerprint =
    typeof raw.provisionerPlanFingerprint === "string" ? raw.provisionerPlanFingerprint.trim() : "";
  const buildInputsFingerprint =
    typeof raw.buildInputsFingerprint === "string" ? raw.buildInputsFingerprint.trim() : "";
  const attestations = normalizeAttestationEvidence(raw.attestations);
  const sboms = normalizeSbomEvidence(raw.sboms);
  const supplyChainGates = normalizeSupplyChainGateEvidence(raw.supplyChainGates);
  return {
    ...(requestedBy ? { requestedBy } : {}),
    ...(submittedBy ? { submittedBy } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    ...(approvals.length > 0 ? { approvals } : {}),
    ...(prerequisiteHealth.length > 0 ? { prerequisiteHealth } : {}),
    ...(laneGovernance ? { laneGovernance } : {}),
    ...(provisionerPlanFingerprint ? { provisionerPlanFingerprint } : {}),
    ...(buildInputsFingerprint ? { buildInputsFingerprint } : {}),
    ...(attestations.length > 0 ? { attestations } : {}),
    ...(sboms.length > 0 ? { sboms } : {}),
    ...(supplyChainGates.length > 0 ? { supplyChainGates } : {}),
  };
}
