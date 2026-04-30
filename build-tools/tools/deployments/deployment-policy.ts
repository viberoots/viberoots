#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels.ts";
import type { GraphNode } from "../lib/graph.ts";
import { readString, readStringArray, readStringRecord } from "./deployment-graph-readers.ts";
import type { DeploymentLaneGovernance } from "./deployment-lane-governance.ts";
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
import {
  lanePromotionCompatibilityFingerprintPart,
  readLanePromotionCompatibility,
  type DeploymentLanePromotionCompatibility,
} from "./deployment-lane-promotion-compatibility.ts";
import { extractDeploymentDefaults } from "./deployment-defaults.ts";
import { fingerprintPolicy } from "./deployment-policy-fingerprint.ts";

export const DEPLOYMENT_LANE_POLICY_RULE = "deployment_lane_policy";
export const DEPLOYMENT_ADMISSION_POLICY_RULE = "deployment_admission_policy";
export type ArtifactReuseMode = "same_artifact" | "rebuild_per_stage";
export type RetryBranchPolicy = "branch_independent" | "branch_coupled";
export type RetryApprovalReuse = "fresh_only" | "same_lineage";
export type ArtifactAttestationMode = "recorded_exact_artifact";

export type DeploymentLanePolicy = {
  ref: string;
  name: string;
  defaultsRef?: string;
  stages: string[];
  stageBranches: Record<string, string>;
  allowedPromotionEdges: string[];
  artifactReuseMode: ArtifactReuseMode;
  promotionCompatibility?: DeploymentLanePromotionCompatibility;
  defaultClientProfile?: string;
  governanceRef: string;
  governance: DeploymentLaneGovernance;
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

function policyError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function extractDeploymentLanePoliciesWithGovernance(
  nodes: GraphNode[],
  governancePolicies: Map<string, DeploymentLaneGovernance>,
): {
  policies: Map<string, DeploymentLanePolicy>;
  errors: string[];
} {
  const policies = new Map<string, DeploymentLanePolicy>();
  const errors: string[] = [];
  const extractedDefaults = extractDeploymentDefaults(nodes);
  errors.push(...extractedDefaults.errors);
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_LANE_POLICY_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const name = ref.split(":")[1] || "";
    const defaultsRef = normalizeTargetLabel(readString(node, "defaults"));
    const defaults = defaultsRef ? extractedDefaults.defaults.get(defaultsRef) : undefined;
    const defaultClientProfile =
      readString(node, "default_client_profile") || defaults?.defaultClientProfile || "";
    const stages = readStringArray(node, "stages");
    const stageBranches = readStringRecord(node, "stage_branches");
    const allowedPromotionEdges = readStringArray(node, "allowed_promotion_edges");
    const artifactReuseMode = (readString(node, "artifact_reuse_mode") ||
      "same_artifact") as ArtifactReuseMode;
    const promotionCompatibility = readLanePromotionCompatibility(node, ref);
    const governanceRef = normalizeTargetLabel(readString(node, "governance_policy"));
    const governance = governancePolicies.get(governanceRef);
    if (!ref) {
      errors.push("deployment lane policy missing canonical label");
      continue;
    }
    if (!name) errors.push(policyError(ref, "lane policy must set name"));
    if (defaultsRef && !defaults) {
      errors.push(policyError(ref, `defaults target not found: ${defaultsRef}`));
    }
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
    errors.push(...promotionCompatibility.errors);
    if (!governanceRef) {
      errors.push(policyError(ref, "lane policy must define governance_policy"));
    } else if (!governance) {
      errors.push(policyError(ref, `governance_policy target not found: ${governanceRef}`));
    } else {
      for (const stage of stages) {
        const protection = governance.branchProtections.find((entry) => entry.stage === stage);
        if (!protection) {
          errors.push(
            policyError(ref, `governance_policy ${governanceRef} is missing stage ${stage}`),
          );
        } else if (protection.branch !== stageBranches[stage]) {
          errors.push(
            policyError(
              ref,
              `governance_policy ${governanceRef} branch mismatch for ${stage}: ${protection.branch}`,
            ),
          );
        }
      }
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    const fingerprint = fingerprintPolicy({
      name,
      stages,
      stageBranches,
      allowedPromotionEdges,
      artifactReuseMode,
      ...lanePromotionCompatibilityFingerprintPart(promotionCompatibility.value),
      defaultClientProfile,
      governanceFingerprint: governance!.fingerprint,
    });
    policies.set(ref, {
      ref,
      name,
      ...(defaultsRef ? { defaultsRef } : {}),
      stages,
      stageBranches,
      allowedPromotionEdges,
      artifactReuseMode,
      ...(promotionCompatibility.value
        ? { promotionCompatibility: promotionCompatibility.value }
        : {}),
      ...(defaultClientProfile ? { defaultClientProfile } : {}),
      governanceRef,
      governance: governance!,
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
    const fingerprint = fingerprintPolicy({
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
