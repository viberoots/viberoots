#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels";
import type { GraphNode } from "../lib/graph";
import { readString, readStringArray } from "./deployment-graph-readers";
import {
  readAttestationPolicy,
  readSbomPolicy,
  readSupplyChainGatePolicies,
} from "./deployment-admission-supply-chain";
import {
  admissionPolicyExtensionFingerprintPart,
  validateAdmissionPolicyExtensions,
} from "./deployment-policy-admission-extensions";
import { fingerprintPolicy } from "./deployment-policy-fingerprint";
import {
  readReadinessGatePolicies,
  validateReadinessGatePolicies,
} from "./deployment-readiness-gates";
import {
  type ArtifactAttestationMode,
  type DeploymentAdmissionPolicy,
  type RetryApprovalReuse,
  type RetryBranchPolicy,
} from "./deployment-policy";

const DEPLOYMENT_ADMISSION_POLICY_RULE = "deployment_admission_policy";

export function extractDeploymentAdmissionPolicies(nodes: GraphNode[]): {
  policies: Map<string, DeploymentAdmissionPolicy>;
  errors: string[];
} {
  const policies = new Map<string, DeploymentAdmissionPolicy>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_ADMISSION_POLICY_RULE) continue;
    const policy = readPolicyNode(node);
    errors.push(...policy.errors);
    if (policy.errors.length > 0) continue;
    policies.set(policy.value.ref, policy.value);
  }
  return { policies, errors };
}

function readPolicyNode(node: GraphNode) {
  const ref = normalizeTargetLabel(String(node.name || ""));
  const name = ref.split(":")[1] || "";
  const allowedRefs = readStringArray(node, "allowed_refs");
  const requiredChecks = readStringArray(node, "required_checks");
  const requiredApprovals = readStringArray(node, "required_approvals");
  const readinessGates = readReadinessGatePolicies(node);
  const retryBranchPolicy = (readString(node, "retry_branch_policy") ||
    "branch_independent") as RetryBranchPolicy;
  const retryApprovalReuse = (readString(node, "retry_approval_reuse") ||
    "fresh_only") as RetryApprovalReuse;
  const artifactAttestationMode = (readString(node, "artifact_attestation_mode") ||
    "recorded_exact_artifact") as ArtifactAttestationMode;
  const attestation = readAttestationPolicy(node);
  const sbom = readSbomPolicy(node);
  const supplyChainGates = readSupplyChainGatePolicies(node);
  const errors = policyErrors(ref, {
    name,
    allowedRefs,
    retryBranchPolicy,
    retryApprovalReuse,
    artifactAttestationMode,
  });
  errors.push(...validateReadinessGatePolicies(ref, readinessGates));
  errors.push(...validateAdmissionPolicyExtensions({ ref, attestation, supplyChainGates }));
  const fingerprint = fingerprintPolicy({
    name,
    allowedRefs,
    requiredChecks,
    requiredApprovals,
    readinessGates,
    retryBranchPolicy,
    retryApprovalReuse,
    artifactAttestationMode,
    ...admissionPolicyExtensionFingerprintPart({ attestation, sbom, supplyChainGates }),
  });
  return {
    errors,
    value: {
      ref,
      name,
      allowedRefs,
      requiredChecks,
      requiredApprovals,
      readinessGates,
      retryBranchPolicy,
      retryApprovalReuse,
      artifactAttestationMode,
      ...(attestation ? { attestation } : {}),
      ...(sbom ? { sbom } : {}),
      supplyChainGates,
      fingerprint,
    },
  };
}

function policyErrors(
  ref: string,
  policy: {
    name: string;
    allowedRefs: string[];
    retryBranchPolicy: RetryBranchPolicy;
    retryApprovalReuse: RetryApprovalReuse;
    artifactAttestationMode: ArtifactAttestationMode;
  },
) {
  const errors: string[] = [];
  if (!ref) return ["deployment admission policy missing canonical label"];
  if (!policy.name) errors.push(policyError(ref, "admission policy must set name"));
  if (policy.allowedRefs.length === 0) {
    errors.push(policyError(ref, "admission policy must define allowed_refs"));
  }
  if (
    policy.retryBranchPolicy !== "branch_independent" &&
    policy.retryBranchPolicy !== "branch_coupled"
  ) {
    errors.push(policyError(ref, `unsupported retry_branch_policy "${policy.retryBranchPolicy}"`));
  }
  if (policy.retryApprovalReuse !== "fresh_only" && policy.retryApprovalReuse !== "same_lineage") {
    errors.push(
      policyError(ref, `unsupported retry_approval_reuse "${policy.retryApprovalReuse}"`),
    );
  }
  if (policy.artifactAttestationMode !== "recorded_exact_artifact") {
    errors.push(
      policyError(ref, `unsupported artifact_attestation_mode "${policy.artifactAttestationMode}"`),
    );
  }
  return errors;
}

function policyError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}
