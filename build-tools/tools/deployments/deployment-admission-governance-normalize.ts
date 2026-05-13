#!/usr/bin/env zx-wrapper
import type {
  DeploymentApprovalBoundary,
  DeploymentSourceRefPolicy,
} from "./deployment-lane-governance";

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

export function normalizeSourceRefPolicies(value: unknown): DeploymentSourceRefPolicy[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const allowedRefs = readStringList(raw.allowedRefs);
      if (!stage || allowedRefs.length === 0) return undefined;
      return { stage, allowedRefs, requiredChecks: readStringList(raw.requiredChecks) };
    })
    .filter((entry): entry is DeploymentSourceRefPolicy => !!entry);
}

export function normalizeTrustedReporterIdentities(value: unknown): string[] {
  return readStringList(value);
}

export function normalizeApprovalBoundaries(value: unknown): DeploymentApprovalBoundary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const requiredApprovals = readStringList(raw.requiredApprovals);
      if (!stage || requiredApprovals.length === 0) return undefined;
      return { stage, requiredApprovals };
    })
    .filter((entry): entry is DeploymentApprovalBoundary => !!entry);
}
