#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { normalizeTargetLabel } from "../lib/labels";
import type { GraphNode } from "../lib/graph";
import { staleEnvironmentRefErrors } from "./deployment-source-ref-policy";

export const DEPLOYMENT_LANE_GOVERNANCE_RULE = "deployment_lane_governance";

export type DeploymentScmBackend = "github" | "gitlab";

export type DeploymentSourceRefPolicy = {
  stage: string;
  allowedRefs: string[];
  requiredChecks: string[];
};

export type DeploymentApprovalBoundary = {
  stage: string;
  requiredApprovals: string[];
};

export type DeploymentLaneGovernance = {
  ref: string;
  name: string;
  scmBackend: DeploymentScmBackend;
  repository: string;
  sourceRefPolicies: DeploymentSourceRefPolicy[];
  trustedReporterIdentities: string[];
  requiredApprovalBoundaries: DeploymentApprovalBoundary[];
  fingerprint: string;
};

type ExtractionResult = {
  policies: Map<string, DeploymentLaneGovernance>;
  errors: string[];
};

function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

function readStringArray(node: GraphNode, key: string): string[] {
  return Array.isArray(node[key])
    ? node[key].filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
}

function readCsvList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  }
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readSourceRefPolicies(node: GraphNode): DeploymentSourceRefPolicy[] {
  if (!Array.isArray(node.source_ref_policies)) return [];
  return node.source_ref_policies
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const allowedRefs = readCsvList(raw.allowed_refs);
      const requiredChecks = readCsvList(raw.required_checks);
      if (!stage || allowedRefs.length === 0) return undefined;
      return { stage, allowedRefs, requiredChecks };
    })
    .filter((entry): entry is DeploymentSourceRefPolicy => !!entry);
}

function readApprovalBoundaries(node: GraphNode): DeploymentApprovalBoundary[] {
  if (!Array.isArray(node.required_approval_boundaries)) return [];
  return node.required_approval_boundaries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const requiredApprovals = readCsvList(raw.required_approvals);
      if (!stage || requiredApprovals.length === 0) return undefined;
      return { stage, requiredApprovals };
    })
    .filter((entry): entry is DeploymentApprovalBoundary => !!entry);
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

function governanceError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function extractDeploymentLaneGovernancePolicies(nodes: GraphNode[]): ExtractionResult {
  const policies = new Map<string, DeploymentLaneGovernance>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_LANE_GOVERNANCE_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const name = ref.split(":")[1] || "";
    const scmBackend = readString(node, "scm_backend") as DeploymentScmBackend;
    const repository = readString(node, "repository");
    const sourceRefPolicies = readSourceRefPolicies(node);
    const trustedReporterIdentities = readStringArray(node, "trusted_reporter_identities");
    const requiredApprovalBoundaries = readApprovalBoundaries(node);
    if (!ref) {
      errors.push("deployment lane governance missing canonical label");
      continue;
    }
    if (!name) errors.push(governanceError(ref, "lane governance must set name"));
    if (scmBackend !== "github" && scmBackend !== "gitlab") {
      errors.push(governanceError(ref, `unsupported scm_backend "${scmBackend || "<empty>"}"`));
    }
    if (!repository) {
      errors.push(governanceError(ref, "lane governance must define repository"));
    }
    if (sourceRefPolicies.length === 0) {
      errors.push(governanceError(ref, "lane governance must define source_ref_policies"));
    }
    if (trustedReporterIdentities.length === 0) {
      errors.push(governanceError(ref, "lane governance must define trusted_reporter_identities"));
    }
    if (requiredApprovalBoundaries.length === 0) {
      errors.push(governanceError(ref, "lane governance must define required_approval_boundaries"));
    }
    const seenSourceStages = new Set<string>();
    for (const policy of sourceRefPolicies) {
      if (seenSourceStages.has(policy.stage)) {
        errors.push(governanceError(ref, `duplicate source_ref_policies stage "${policy.stage}"`));
      }
      seenSourceStages.add(policy.stage);
      errors.push(
        ...staleEnvironmentRefErrors({
          label: ref,
          field: `source_ref_policies allowed_refs for ${policy.stage}`,
          refs: policy.allowedRefs,
        }),
      );
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    policies.set(ref, {
      ref,
      name,
      scmBackend,
      repository,
      sourceRefPolicies,
      trustedReporterIdentities,
      requiredApprovalBoundaries,
      fingerprint: fingerprintFor({
        name,
        scmBackend,
        repository,
        sourceRefPolicies,
        trustedReporterIdentities,
        requiredApprovalBoundaries,
      }),
    });
  }
  return { policies, errors };
}
