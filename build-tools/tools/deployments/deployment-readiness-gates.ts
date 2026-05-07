#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionBinding } from "./deployment-admission-evidence";
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding";
import type { DeploymentTarget } from "./contract-types";
import { providerTargetIdentityFor } from "./deployment-targets";
import { mcpSourceResponseBoundaryErrors } from "./deployment-boundary-checks";
import {
  DEPLOYMENT_ADMISSION_ACCESS_MODES,
  DEPLOYMENT_READINESS_GATE_TYPES,
  type DeploymentAdmissionAccessMode,
  type DeploymentReadinessGateEvidence,
  type DeploymentReadinessGateFact,
  type DeploymentReadinessGatePolicy,
  type DeploymentReadinessGateType,
} from "./deployment-readiness-gate-types";
export * from "./deployment-readiness-gate-types";
const DEPLOYMENT_ADMISSION_OPERATION_KINDS = [
  "deploy",
  "provision_only",
  "promotion",
  "retry",
  "rollback",
  "preview",
];

function isGateType(value: string): value is DeploymentReadinessGateType {
  return DEPLOYMENT_READINESS_GATE_TYPES.includes(value as DeploymentReadinessGateType);
}

export function readReadinessGatePolicies(node: Record<string, unknown>) {
  const raw = Array.isArray(node.readiness_gates) ? node.readiness_gates : [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const rawEntry = entry as Record<string, unknown>;
      const name =
        typeof rawEntry.name === "string"
          ? rawEntry.name.trim()
          : typeof rawEntry.id === "string"
            ? rawEntry.id.trim()
            : "";
      const type = typeof rawEntry.type === "string" ? rawEntry.type.trim() : "";
      const requiredFor = String(rawEntry.required_for || "deploy")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean) as DeploymentAdmissionOperationKind[];
      const requiredAccess = csv(rawEntry.required_access) as DeploymentAdmissionAccessMode[];
      const gateVersion = readText(rawEntry, "gate_version") || "v1";
      const credentialSource = readText(rawEntry, "credential_source");
      return {
        name,
        type: type as DeploymentReadinessGateType,
        requiredFor,
        gateVersion,
        ...(requiredAccess.length > 0 ? { requiredAccess } : {}),
        ...(readText(rawEntry, "source") ? { source: readText(rawEntry, "source") } : {}),
        ...(readText(rawEntry, "client") ? { client: readText(rawEntry, "client") } : {}),
        ...(readText(rawEntry, "policy_combination")
          ? { policyCombination: readText(rawEntry, "policy_combination") }
          : {}),
        ...(readText(rawEntry, "credential_contract_id")
          ? { credentialContractId: readText(rawEntry, "credential_contract_id") }
          : {}),
        ...(credentialSource === "secret_runtime" ? { credentialSource } : {}),
        ...(readText(rawEntry, "secret_runtime_step")
          ? { secretRuntimeStep: readText(rawEntry, "secret_runtime_step") }
          : {}),
      };
    })
    .filter((entry): entry is DeploymentReadinessGatePolicy => !!entry);
}

export function validateReadinessGatePolicies(ref: string, gates: DeploymentReadinessGatePolicy[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const gate of gates) {
    const key = gate.name;
    if (!gate.name) {
      errors.push(`${ref}: readiness_gates entry must set name`);
      continue;
    }
    if (seen.has(key)) errors.push(`${ref}: duplicate readiness_gates entry "${gate.name}"`);
    seen.add(key);
    if (!isGateType(gate.type)) {
      errors.push(`${ref}: readiness_gates ${gate.name} has unsupported type "${gate.type}"`);
    }
    if (gate.requiredFor.length === 0) {
      errors.push(`${ref}: readiness_gates ${gate.name} must set required_for`);
    }
    if (!gate.gateVersion)
      errors.push(`${ref}: readiness_gates ${gate.name} must set gate_version`);
    for (const operation of gate.requiredFor) {
      if (!DEPLOYMENT_ADMISSION_OPERATION_KINDS.includes(operation)) {
        errors.push(
          `${ref}: readiness_gates ${gate.name} has unsupported required_for "${operation}"`,
        );
      }
    }
    for (const access of gate.requiredAccess || []) {
      if (!DEPLOYMENT_ADMISSION_ACCESS_MODES.includes(access)) {
        errors.push(
          `${ref}: readiness_gates ${gate.name} has unsupported required_access "${access}"`,
        );
      }
    }
    if (gate.credentialContractId) {
      if (gate.credentialSource !== "secret_runtime") {
        errors.push(`${ref}: readiness_gates ${gate.name} credentials must use secret_runtime`);
      }
      if (!gate.secretRuntimeStep) {
        errors.push(`${ref}: readiness_gates ${gate.name} must set secret_runtime_step`);
      }
    }
  }
  return errors;
}

export function normalizeReadinessGateEvidence(value: unknown): DeploymentReadinessGateEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const name = readText(raw, "name");
      const type = readText(raw, "type");
      const status = raw.status === "passed" ? "passed" : raw.status === "failed" ? "failed" : "";
      const checkedAt = readText(raw, "checkedAt");
      const gateVersion = readText(raw, "gateVersion");
      const deploymentId = readText(raw, "deploymentId");
      const environmentStage = readText(raw, "environmentStage");
      const providerTargetIdentity = readText(raw, "providerTargetIdentity");
      const evidenceRef = readText(raw, "evidenceRef");
      const redactedSummary = readText(raw, "redactedSummary");
      const diagnostics = normalizeDiagnostics(raw.diagnostics);
      if (!name || !isGateType(type) || !status || !checkedAt || !gateVersion) return undefined;
      if (!deploymentId || !environmentStage) return undefined;
      if (!providerTargetIdentity || !evidenceRef || hasForbiddenPayload(raw)) return undefined;
      if (!redactedSummary || !diagnostics) return undefined;
      if (mcpSourceResponseBoundaryErrors(raw).length > 0) return undefined;
      return {
        name,
        type,
        status,
        checkedAt,
        ...(readText(raw, "expiresAt") ? { expiresAt: readText(raw, "expiresAt") } : {}),
        gateVersion,
        deploymentId,
        environmentStage,
        providerTargetIdentity,
        ...(readText(raw, "source") ? { source: readText(raw, "source") } : {}),
        ...(readText(raw, "client") ? { client: readText(raw, "client") } : {}),
        ...(readText(raw, "policyCombination")
          ? { policyCombination: readText(raw, "policyCombination") }
          : {}),
        ...(readText(raw, "sourceRevision")
          ? { sourceRevision: readText(raw, "sourceRevision") }
          : {}),
        ...(readText(raw, "sourceRunId") ? { sourceRunId: readText(raw, "sourceRunId") } : {}),
        evidenceRef,
        redactedSummary,
        diagnostics,
      };
    })
    .filter((entry): entry is DeploymentReadinessGateEvidence => !!entry);
}

export function evaluateReadinessGatePolicies(opts: {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  binding: DeploymentAdmissionBinding;
  accessMode?: DeploymentAdmissionAccessMode;
  evidence?: DeploymentReadinessGateEvidence[];
}): DeploymentReadinessGateFact[] {
  const facts: DeploymentReadinessGateFact[] = [];
  for (const policy of opts.deployment.admissionPolicy.readinessGates || []) {
    if (!policy.requiredFor.includes(opts.operationKind)) continue;
    if (!policyAppliesToAccess(policy, opts.accessMode)) continue;
    const evidence = (opts.evidence || []).find((entry) => matchesPolicy(opts, policy, entry));
    if (!evidence) throw new Error(`admission requires readiness gate ${policy.name}`);
    facts.push({ ...evidence, status: "passed" });
  }
  return facts;
}

function matchesPolicy(
  opts: {
    deployment: DeploymentTarget;
    binding: DeploymentAdmissionBinding;
  },
  policy: DeploymentReadinessGatePolicy,
  evidence: DeploymentReadinessGateEvidence,
) {
  if (evidence.name !== policy.name || evidence.type !== policy.type) return false;
  if (evidence.status !== "passed") return false;
  if (isExpired(evidence.expiresAt)) return false;
  if (evidence.gateVersion !== policy.gateVersion) return false;
  if (!matchesDimension(policy.source, evidence.source)) return false;
  if (!matchesDimension(policy.client, evidence.client)) return false;
  if (!matchesDimension(policy.policyCombination, evidence.policyCombination)) return false;
  if (!evidence.redactedSummary?.trim() || !evidence.diagnostics?.summary?.trim()) return false;
  if (evidence.deploymentId !== opts.deployment.deploymentId) return false;
  if (evidence.environmentStage !== opts.deployment.environmentStage) return false;
  if (evidence.providerTargetIdentity !== providerTargetIdentityFor(opts.deployment)) return false;
  if (opts.binding.sourceRevision && evidence.sourceRevision !== opts.binding.sourceRevision) {
    return false;
  }
  if (opts.binding.sourceRunId && evidence.sourceRunId !== opts.binding.sourceRunId) return false;
  return true;
}

function matchesDimension(expected?: string, actual?: string): boolean {
  return !expected || expected === actual;
}

function readText(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? String(raw[key]).trim() : "";
}

function csv(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function policyAppliesToAccess(
  policy: DeploymentReadinessGatePolicy,
  accessMode?: DeploymentAdmissionAccessMode,
) {
  if (!policy.requiredAccess || policy.requiredAccess.length === 0) return true;
  return !!accessMode && policy.requiredAccess.includes(accessMode);
}

function isExpired(expiresAt?: string): boolean {
  return !!expiresAt && Date.parse(expiresAt) <= Date.now();
}

function normalizeDiagnostics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (hasForbiddenPayload(raw) || mcpSourceResponseBoundaryErrors(raw).length > 0) return undefined;
  const summary = readText(raw, "summary");
  const reviewContextRef = readText(raw, "reviewContextRef");
  if (!summary) return undefined;
  return { summary, ...(reviewContextRef ? { reviewContextRef } : {}) };
}

function hasForbiddenPayload(raw: Record<string, unknown>): boolean {
  return ["secretValue", "token", "rawDiagnostics", "providerResponse"].some((key) => key in raw);
}
