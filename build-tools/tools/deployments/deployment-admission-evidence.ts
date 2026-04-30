#!/usr/bin/env zx-wrapper
import type { DeploymentPrerequisiteMode } from "./contract-types.ts";
import {
  normalizeCheckReportingKind,
  type DeploymentAdmissionCheckFact,
  type DeploymentCheckEvidence,
} from "./deployment-admission-checks.ts";
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

export type {
  DeploymentAdmissionCheckFact,
  DeploymentCheckEvidence,
  DeploymentCheckReportingKind,
} from "./deployment-admission-checks.ts";

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

function readText(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? String(raw[key]).trim() : "";
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
    const rawEntry = entry as Record<string, unknown>;
    const name = readText(rawEntry, "name");
    const subject = readText(rawEntry, "subject");
    const status = entry.status === "failed" ? "failed" : entry.status === "passed" ? "passed" : "";
    const checkedAt = readText(rawEntry, "checkedAt");
    if (!name || !subject || !status || !checkedAt) return undefined;
    const deploymentId = readText(rawEntry, "deploymentId");
    const environmentStage = readText(rawEntry, "environmentStage");
    const admissionPolicyRef = readText(rawEntry, "admissionPolicyRef");
    const recordRef = readText(rawEntry, "recordRef");
    const reportingKind = normalizeCheckReportingKind(entry.reportingKind);
    return {
      name,
      subject,
      status,
      checkedAt,
      ...(deploymentId ? { deploymentId } : {}),
      ...(environmentStage ? { environmentStage } : {}),
      ...(admissionPolicyRef ? { admissionPolicyRef } : {}),
      ...(recordRef ? { recordRef } : {}),
      ...(reportingKind ? { reportingKind } : {}),
    };
  });
  const approvals = normalizeList(raw.approvals, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const rawEntry = entry as Record<string, unknown>;
    const name = readText(rawEntry, "name");
    const approvalId = readText(rawEntry, "approvalId");
    const status =
      entry.status === "approved" ? "approved" : entry.status === "revoked" ? "revoked" : "";
    const grantedAt = readText(rawEntry, "grantedAt");
    const payloadFingerprint = readText(rawEntry, "payloadFingerprint");
    const deploymentId = readText(rawEntry, "deploymentId");
    const targetIdentity = readText(rawEntry, "targetIdentity");
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
    const expiresAt = readText(rawEntry, "expiresAt");
    const recordRef = readText(rawEntry, "recordRef");
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
    const rawEntry = entry as Record<string, unknown>;
    const deploymentId = readText(rawEntry, "deploymentId");
    const status =
      entry.status === "healthy" ? "healthy" : entry.status === "unhealthy" ? "unhealthy" : "";
    const checkedAt = readText(rawEntry, "checkedAt");
    if (!deploymentId || !status || !checkedAt) return undefined;
    const evidenceRef = readText(rawEntry, "evidenceRef");
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
