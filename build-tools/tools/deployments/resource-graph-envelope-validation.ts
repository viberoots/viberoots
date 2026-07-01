#!/usr/bin/env zx-wrapper
import type { DeploymentResourceInventoryEntry } from "./resource-graph-types";

type IndexedRef = {
  kind: DeploymentResourceInventoryEntry["kind"];
  id: string;
};

const DEPLOYMENT_REF_KINDS = new Set<DeploymentResourceInventoryEntry["kind"]>([
  "DeploymentFamily",
  "Component",
  "ProviderTarget",
  "DeploymentContext",
  "ControlPlaneProfile",
  "ControlPlaneSelection",
  "ServiceClientProfile",
  "EnvironmentStage",
  "LanePolicy",
  "LaneGovernancePolicy",
  "AdmissionPolicy",
  "RolloutPolicy",
  "PreviewPolicy",
  "SmokePolicy",
  "SourceRefPolicy",
  "ReadinessGatePolicy",
  "AttestationPolicy",
  "SbomPolicy",
  "SupplyChainPolicy",
  "SecretRequirement",
  "RuntimeConfigRequirement",
  "DeploymentTargetException",
  "Provisioner",
  "ReleaseAction",
  "ArtifactInput",
]);

export function inventoryRefErrors(resources: DeploymentResourceInventoryEntry[]): string[] {
  const byId = refsIndex(resources);
  return resources.flatMap((resource) => resourceRefErrors(resource, byId));
}

function resourceRefErrors(
  resource: DeploymentResourceInventoryEntry,
  byId: Map<string, IndexedRef[]>,
): string[] {
  const errors = sourceLabelErrors(resource);
  if (resource.kind !== "Deployment") return errors;
  const refs = resource.refs || [];
  errors.push(...deploymentFactRefErrors(resource, byId));
  for (const ref of refs) {
    const matches = byId.get(ref) || [];
    if (matches.length === 0) {
      errors.push(`${resource.kind} ${resource.id}: unresolved resource ref ${ref}`);
    } else if (matches.every((match) => !DEPLOYMENT_REF_KINDS.has(match.kind))) {
      errors.push(`${resource.kind} ${resource.id}: unsupported deployment ref ${ref}`);
    }
  }
  if (!refs.some((ref) => (byId.get(ref) || []).some((match) => match.kind === "ProviderTarget"))) {
    errors.push(`${resource.kind} ${resource.id}: missing ProviderTarget ref`);
  }
  return errors;
}

function deploymentFactRefErrors(
  resource: DeploymentResourceInventoryEntry,
  byId: Map<string, IndexedRef[]>,
): string[] {
  return [
    ...requiredKindErrors(resource, byId, "providerTargetIdentity", ["ProviderTarget"]),
    ...requiredKindErrors(resource, byId, "lanePolicyRef", ["LanePolicy"]),
    ...requiredKindErrors(resource, byId, "admissionPolicyRef", ["AdmissionPolicy"]),
    ...listKindErrors(resource, byId, "secretRequirementRefs", ["SecretRequirement"]),
    ...listKindErrors(resource, byId, "runtimeConfigRequirementRefs", ["RuntimeConfigRequirement"]),
  ];
}

function requiredKindErrors(
  owner: DeploymentResourceInventoryEntry,
  index: Map<string, IndexedRef[]>,
  key: string,
  kinds: DeploymentResourceInventoryEntry["kind"][],
): string[] {
  const ref = factString(owner, key);
  return ref ? kindErrors(owner, index, key, ref, kinds) : [];
}

function listKindErrors(
  owner: DeploymentResourceInventoryEntry,
  index: Map<string, IndexedRef[]>,
  key: string,
  kinds: DeploymentResourceInventoryEntry["kind"][],
): string[] {
  return factList(owner, key).flatMap((ref) => kindErrors(owner, index, key, ref, kinds));
}

function kindErrors(
  owner: DeploymentResourceInventoryEntry,
  byId: Map<string, IndexedRef[]>,
  key: string,
  ref: string,
  kinds: DeploymentResourceInventoryEntry["kind"][],
): string[] {
  const matches = byId.get(ref) || [];
  if (matches.length === 0) return [`${owner.kind} ${owner.id}: ${key} unresolved: ${ref}`];
  if (matches.some((match) => kinds.includes(match.kind))) return [];
  return [
    `${owner.kind} ${owner.id}: ${key} must reference ${kinds.join(" or ")}, got ${matches
      .map((match) => match.kind)
      .join(", ")}`,
  ];
}

function sourceLabelErrors(resource: DeploymentResourceInventoryEntry): string[] {
  const label = resource.source.label || "";
  if (!label || resource.source.class === "runtime" || resource.source.class === "workspace_state")
    return [];
  if (label.startsWith("//") || label.startsWith("provider-capability:")) return [];
  return [`${resource.kind} ${resource.id}: invalid source label ${label}`];
}

function factString(resource: DeploymentResourceInventoryEntry, key: string): string {
  const raw = (resource.facts || {})[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function factList(resource: DeploymentResourceInventoryEntry, key: string): string[] {
  const raw = (resource.facts || {})[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function refsIndex(resources: DeploymentResourceInventoryEntry[]): Map<string, IndexedRef[]> {
  const out = new Map<string, IndexedRef[]>();
  for (const resource of resources) {
    out.set(resource.id, [
      ...(out.get(resource.id) || []),
      { kind: resource.kind, id: resource.id },
    ]);
  }
  return out;
}
