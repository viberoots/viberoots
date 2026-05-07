#!/usr/bin/env zx-wrapper
import type {
  DeploymentAdmissionEvidence,
  DeploymentPrincipal,
} from "./deployment-admission-evidence";
import { normalizeCheckReportingKind } from "./deployment-admission-checks";
import { normalizeLaneGovernanceEvidence } from "./deployment-admission-governance";
import {
  normalizeAttestationEvidence,
  normalizeSbomEvidence,
  normalizeSupplyChainGateEvidence,
} from "./deployment-admission-supply-chain";
import { normalizeReadinessGateEvidence } from "./deployment-readiness-gates";

const ACCESS_MODES = ["direct_upload_pilot", "connector_demo", "connector_internal"];

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

export function normalizeAdmissionEvidence(
  value: unknown,
): DeploymentAdmissionEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const accessMode = ACCESS_MODES.includes(readText(raw, "accessMode"))
    ? readText(raw, "accessMode")
    : "";
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
  const approvals = normalizeList(raw.approvals, normalizeApprovalEvidence);
  const prerequisiteHealth = normalizeList(raw.prerequisiteHealth, normalizeHealthEvidence);
  const requestedBy = normalizePrincipal(raw.requestedBy);
  const submittedBy = normalizePrincipal(raw.submittedBy);
  const laneGovernance = normalizeLaneGovernanceEvidence(raw.laneGovernance);
  const provisionerPlanFingerprint = readText(raw, "provisionerPlanFingerprint");
  const buildInputsFingerprint = readText(raw, "buildInputsFingerprint");
  const attestations = normalizeAttestationEvidence(raw.attestations);
  const sboms = normalizeSbomEvidence(raw.sboms);
  const supplyChainGates = normalizeSupplyChainGateEvidence(raw.supplyChainGates);
  const readinessGates = normalizeReadinessGateEvidence(raw.readinessGates);
  const phase0CompatibilityException = normalizePhase0CompatibilityException(
    raw.phase0CompatibilityException,
  );
  return {
    ...(accessMode ? { accessMode: accessMode as DeploymentAdmissionEvidence["accessMode"] } : {}),
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
    ...(readinessGates.length > 0 ? { readinessGates } : {}),
    ...(phase0CompatibilityException ? { phase0CompatibilityException } : {}),
  };
}

function normalizeApprovalEvidence(entry: unknown) {
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
  if (!name || !approvalId || !status || !grantedAt || !payloadFingerprint || !deploymentId) {
    return undefined;
  }
  if (!targetIdentity || !approver) return undefined;
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
}

function normalizeHealthEvidence(entry: unknown) {
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
}

function normalizePhase0CompatibilityException(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const rawEntry = entry as Record<string, unknown>;
  const reviewedBy = readText(rawEntry, "reviewedBy");
  const reason = readText(rawEntry, "reason");
  const expiresAt = readText(rawEntry, "expiresAt");
  return reviewedBy || reason || expiresAt ? { reviewedBy, reason, expiresAt } : undefined;
}
