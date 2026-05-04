#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionBinding } from "./deployment-admission-evidence";
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding";
import type { DeploymentTarget } from "./contract-types";
import { providerTargetIdentityFor } from "./deployment-targets";
import { mcpSourceResponseBoundaryErrors } from "./deployment-boundary-checks";

export type DeploymentReadinessGateType =
  | "ragie_acl_semantics"
  | "tenant_leak_check"
  | "workos_mcp_auth"
  | "storage_grant_lifecycle"
  | "connect_metadata_oauth";

export type DeploymentReadinessGatePolicy = {
  name: string;
  type: DeploymentReadinessGateType;
  requiredFor: DeploymentAdmissionOperationKind[];
};

export type DeploymentReadinessGateEvidence = {
  name: string;
  type: DeploymentReadinessGateType;
  status: "passed" | "failed";
  checkedAt: string;
  deploymentId: string;
  providerTargetIdentity: string;
  sourceRevision?: string;
  sourceRunId?: string;
  evidenceRef: string;
  redactedSummary?: string;
};

export type DeploymentReadinessGateFact = DeploymentReadinessGateEvidence & {
  status: "passed";
};

export const DEPLOYMENT_READINESS_GATE_TYPES: DeploymentReadinessGateType[] = [
  "ragie_acl_semantics",
  "tenant_leak_check",
  "workos_mcp_auth",
  "storage_grant_lifecycle",
  "connect_metadata_oauth",
];
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
      const name = typeof rawEntry.name === "string" ? rawEntry.name.trim() : "";
      const type = typeof rawEntry.type === "string" ? rawEntry.type.trim() : "";
      const requiredFor = String(rawEntry.required_for || "deploy")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean) as DeploymentAdmissionOperationKind[];
      if (!name) return undefined;
      return { name, type: type as DeploymentReadinessGateType, requiredFor };
    })
    .filter((entry): entry is DeploymentReadinessGatePolicy => !!entry);
}

export function validateReadinessGatePolicies(ref: string, gates: DeploymentReadinessGatePolicy[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const gate of gates) {
    const key = gate.name;
    if (seen.has(key)) errors.push(`${ref}: duplicate readiness_gates entry "${gate.name}"`);
    seen.add(key);
    if (!isGateType(gate.type)) {
      errors.push(`${ref}: readiness_gates ${gate.name} has unsupported type "${gate.type}"`);
    }
    if (gate.requiredFor.length === 0) {
      errors.push(`${ref}: readiness_gates ${gate.name} must set required_for`);
    }
    for (const operation of gate.requiredFor) {
      if (!DEPLOYMENT_ADMISSION_OPERATION_KINDS.includes(operation)) {
        errors.push(
          `${ref}: readiness_gates ${gate.name} has unsupported required_for "${operation}"`,
        );
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
      const deploymentId = readText(raw, "deploymentId");
      const providerTargetIdentity = readText(raw, "providerTargetIdentity");
      const evidenceRef = readText(raw, "evidenceRef");
      if (!name || !isGateType(type) || !status || !checkedAt || !deploymentId) return undefined;
      if (!providerTargetIdentity || !evidenceRef || hasForbiddenPayload(raw)) return undefined;
      if (mcpSourceResponseBoundaryErrors(raw).length > 0) return undefined;
      return {
        name,
        type,
        status,
        checkedAt,
        deploymentId,
        providerTargetIdentity,
        ...(readText(raw, "sourceRevision")
          ? { sourceRevision: readText(raw, "sourceRevision") }
          : {}),
        ...(readText(raw, "sourceRunId") ? { sourceRunId: readText(raw, "sourceRunId") } : {}),
        evidenceRef,
        ...(readText(raw, "redactedSummary")
          ? { redactedSummary: readText(raw, "redactedSummary") }
          : {}),
      };
    })
    .filter((entry): entry is DeploymentReadinessGateEvidence => !!entry);
}

export function evaluateReadinessGatePolicies(opts: {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  binding: DeploymentAdmissionBinding;
  evidence?: DeploymentReadinessGateEvidence[];
}): DeploymentReadinessGateFact[] {
  const facts: DeploymentReadinessGateFact[] = [];
  for (const policy of opts.deployment.admissionPolicy.readinessGates || []) {
    if (!policy.requiredFor.includes(opts.operationKind)) continue;
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
  if (evidence.deploymentId !== opts.deployment.deploymentId) return false;
  if (evidence.providerTargetIdentity !== providerTargetIdentityFor(opts.deployment)) return false;
  if (opts.binding.sourceRevision && evidence.sourceRevision !== opts.binding.sourceRevision) {
    return false;
  }
  if (opts.binding.sourceRunId && evidence.sourceRunId !== opts.binding.sourceRunId) return false;
  return true;
}

function readText(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? String(raw[key]).trim() : "";
}

function hasForbiddenPayload(raw: Record<string, unknown>): boolean {
  return ["secretValue", "token", "rawDiagnostics", "providerResponse"].some((key) => key in raw);
}
