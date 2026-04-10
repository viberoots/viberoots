#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { normalizeTargetLabel } from "../lib/labels.ts";
import type { GraphNode } from "../lib/graph.ts";
import {
  readAttestationPolicy,
  readSbomPolicy,
  readSupplyChainGatePolicies,
  type DeploymentAttestationPolicy,
  type DeploymentSbomPolicy,
  type DeploymentSupplyChainGatePolicy,
} from "./deployment-admission-supply-chain.ts";
import {
  admissionPolicyExtensionFingerprintPart,
  validateAdmissionPolicyExtensions,
} from "./deployment-policy-admission-extensions.ts";

export const DEPLOYMENT_LANE_POLICY_RULE = "deployment_lane_policy";
export const DEPLOYMENT_ADMISSION_POLICY_RULE = "deployment_admission_policy";

export type ArtifactReuseMode = "same_artifact" | "rebuild_per_stage";
export type RetryBranchPolicy = "branch_independent" | "branch_coupled";
export type RetryApprovalReuse = "fresh_only" | "same_lineage";
export type ArtifactAttestationMode = "recorded_exact_artifact";

export type DeploymentLanePolicy = {
  ref: string;
  name: string;
  stages: string[];
  stageBranches: Record<string, string>;
  allowedPromotionEdges: string[];
  artifactReuseMode: ArtifactReuseMode;
  fingerprint: string;
};

export type DeploymentAdmissionPolicy = {
  ref: string;
  name: string;
  allowedRefs: string[];
  requiredChecks: string[];
  requiredApprovals: string[];
  retryBranchPolicy: RetryBranchPolicy;
  retryApprovalReuse: RetryApprovalReuse;
  artifactAttestationMode: ArtifactAttestationMode;
  attestation?: DeploymentAttestationPolicy;
  sbom?: DeploymentSbomPolicy;
  supplyChainGates: DeploymentSupplyChainGatePolicy[];
  fingerprint: string;
};

function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

function readStringArray(node: GraphNode, key: string): string[] {
  return Array.isArray(node[key])
    ? node[key].filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
}

function readStringRecord(node: GraphNode, key: string): Record<string, string> {
  if (!node[key] || typeof node[key] !== "object" || Array.isArray(node[key])) return {};
  return Object.fromEntries(
    Object.entries(node[key] as Record<string, unknown>)
      .filter(
        ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "string",
      )
      .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
      .filter(([entryKey, entryValue]) => entryKey && entryValue),
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function fingerprintFor(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function policyError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function requiredLaneStageBranch(policy: DeploymentLanePolicy, stage: string): string {
  const stageBranch = policy.stageBranches[stage];
  if (!stageBranch) {
    throw new Error(`lane policy ${policy.ref} does not define stage branch for ${stage}`);
  }
  return stageBranch;
}

export function extractDeploymentLanePolicies(nodes: GraphNode[]): {
  policies: Map<string, DeploymentLanePolicy>;
  errors: string[];
} {
  const policies = new Map<string, DeploymentLanePolicy>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_LANE_POLICY_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const name = ref.split(":")[1] || "";
    const stages = readStringArray(node, "stages");
    const stageBranches = readStringRecord(node, "stage_branches");
    const allowedPromotionEdges = readStringArray(node, "allowed_promotion_edges");
    const artifactReuseMode = (readString(node, "artifact_reuse_mode") ||
      "same_artifact") as ArtifactReuseMode;
    if (!ref) {
      errors.push("deployment lane policy missing canonical label");
      continue;
    }
    if (!name) errors.push(policyError(ref, "lane policy must set name"));
    if (stages.length === 0) errors.push(policyError(ref, "lane policy must define stages"));
    for (const stage of stages) {
      if (!stageBranches[stage]) {
        errors.push(policyError(ref, `lane policy missing stage_branches entry for ${stage}`));
      }
    }
    for (const edge of allowedPromotionEdges) {
      const [from = "", to = ""] = edge.split("->").map((part) => part.trim());
      if (!from || !to) {
        errors.push(policyError(ref, `invalid allowed_promotion_edges entry "${edge}"`));
        continue;
      }
      if (!stages.includes(from) || !stages.includes(to)) {
        errors.push(policyError(ref, `promotion edge "${edge}" references unknown stage`));
      }
    }
    if (artifactReuseMode !== "same_artifact" && artifactReuseMode !== "rebuild_per_stage") {
      errors.push(policyError(ref, `unsupported artifact_reuse_mode "${artifactReuseMode}"`));
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    const fingerprint = fingerprintFor({
      name,
      stages,
      stageBranches,
      allowedPromotionEdges,
      artifactReuseMode,
    });
    policies.set(ref, {
      ref,
      name,
      stages,
      stageBranches,
      allowedPromotionEdges,
      artifactReuseMode,
      fingerprint,
    });
  }
  return { policies, errors };
}

export function extractDeploymentAdmissionPolicies(nodes: GraphNode[]): {
  policies: Map<string, DeploymentAdmissionPolicy>;
  errors: string[];
} {
  const policies = new Map<string, DeploymentAdmissionPolicy>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_ADMISSION_POLICY_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const name = ref.split(":")[1] || "";
    const allowedRefs = readStringArray(node, "allowed_refs");
    const requiredChecks = readStringArray(node, "required_checks");
    const requiredApprovals = readStringArray(node, "required_approvals");
    const retryBranchPolicy = (readString(node, "retry_branch_policy") ||
      "branch_independent") as RetryBranchPolicy;
    const retryApprovalReuse = (readString(node, "retry_approval_reuse") ||
      "fresh_only") as RetryApprovalReuse;
    const artifactAttestationMode = (readString(node, "artifact_attestation_mode") ||
      "recorded_exact_artifact") as ArtifactAttestationMode;
    const attestation = readAttestationPolicy(node);
    const sbom = readSbomPolicy(node);
    const supplyChainGates = readSupplyChainGatePolicies(node);
    if (!ref) {
      errors.push("deployment admission policy missing canonical label");
      continue;
    }
    if (!name) errors.push(policyError(ref, "admission policy must set name"));
    if (allowedRefs.length === 0) {
      errors.push(policyError(ref, "admission policy must define allowed_refs"));
    }
    if (retryBranchPolicy !== "branch_independent" && retryBranchPolicy !== "branch_coupled") {
      errors.push(policyError(ref, `unsupported retry_branch_policy "${retryBranchPolicy}"`));
    }
    if (retryApprovalReuse !== "fresh_only" && retryApprovalReuse !== "same_lineage") {
      errors.push(policyError(ref, `unsupported retry_approval_reuse "${retryApprovalReuse}"`));
    }
    if (artifactAttestationMode !== "recorded_exact_artifact") {
      errors.push(
        policyError(ref, `unsupported artifact_attestation_mode "${artifactAttestationMode}"`),
      );
    }
    errors.push(...validateAdmissionPolicyExtensions({ ref, attestation, supplyChainGates }));
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    const fingerprint = fingerprintFor({
      name,
      allowedRefs,
      requiredChecks,
      requiredApprovals,
      retryBranchPolicy,
      retryApprovalReuse,
      artifactAttestationMode,
      ...admissionPolicyExtensionFingerprintPart({ attestation, sbom, supplyChainGates }),
    });
    policies.set(ref, {
      ref,
      name,
      allowedRefs,
      requiredChecks,
      requiredApprovals,
      retryBranchPolicy,
      retryApprovalReuse,
      artifactAttestationMode,
      ...(attestation ? { attestation } : {}),
      ...(sbom ? { sbom } : {}),
      supplyChainGates,
      fingerprint,
    });
  }
  return { policies, errors };
}
