#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { normalizeTargetLabel } from "../lib/labels";
import type { GraphNode } from "../lib/graph";

export const DEPLOYMENT_LANE_GOVERNANCE_RULE = "deployment_lane_governance";

export type DeploymentScmBackend = "github" | "gitlab";

export type DeploymentLaneBranchGovernance = {
  stage: string;
  branch: string;
  requiredChecks: string[];
  fastForwardOnly: true;
  normalAdvancePrincipals: string[];
  emergencyDirectPushPrincipals: string[];
};

export type DeploymentLaneGovernance = {
  ref: string;
  name: string;
  scmBackend: DeploymentScmBackend;
  repository: string;
  branchProtections: DeploymentLaneBranchGovernance[];
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

function readBranchProtections(node: GraphNode): DeploymentLaneBranchGovernance[] {
  if (!Array.isArray(node.branch_protections)) return [];
  return node.branch_protections
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const branch = typeof raw.branch === "string" ? raw.branch.trim() : "";
      const fastForwardOnly = raw.fast_forward_only === "true" || raw.fast_forward_only === true;
      const requiredChecks = Array.isArray(raw.required_checks)
        ? raw.required_checks.filter(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          )
        : typeof raw.required_checks === "string"
          ? String(raw.required_checks)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
      const normalAdvancePrincipals = Array.isArray(raw.normal_advance_principals)
        ? raw.normal_advance_principals.filter(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          )
        : typeof raw.normal_advance_principals === "string"
          ? String(raw.normal_advance_principals)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
      const emergencyDirectPushPrincipals = Array.isArray(raw.emergency_direct_push_principals)
        ? raw.emergency_direct_push_principals.filter(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          )
        : typeof raw.emergency_direct_push_principals === "string"
          ? String(raw.emergency_direct_push_principals)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
      if (!stage || !branch || !fastForwardOnly) return undefined;
      return {
        stage,
        branch,
        requiredChecks,
        fastForwardOnly: true,
        normalAdvancePrincipals,
        emergencyDirectPushPrincipals,
      };
    })
    .filter((entry): entry is DeploymentLaneBranchGovernance => !!entry);
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
    const branchProtections = readBranchProtections(node);
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
    if (branchProtections.length === 0) {
      errors.push(governanceError(ref, "lane governance must define branch_protections"));
    }
    const seenStages = new Set<string>();
    for (const protection of branchProtections) {
      if (seenStages.has(protection.stage)) {
        errors.push(
          governanceError(ref, `duplicate branch_protections stage "${protection.stage}"`),
        );
      }
      seenStages.add(protection.stage);
      if (protection.normalAdvancePrincipals.length === 0) {
        errors.push(
          governanceError(
            ref,
            `branch_protections must define normal_advance_principals for ${protection.stage}`,
          ),
        );
      }
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    policies.set(ref, {
      ref,
      name,
      scmBackend,
      repository,
      branchProtections,
      fingerprint: fingerprintFor({ name, scmBackend, repository, branchProtections }),
    });
  }
  return { policies, errors };
}
