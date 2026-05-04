#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";

export type DeploymentRequirementStep =
  | "provision"
  | "publish"
  | "preview_cleanup"
  | "smoke"
  | "release_actions.pre_publish"
  | "release_actions.post_publish_pre_smoke"
  | "release_actions.post_smoke";

export const DEPLOYMENT_REQUIREMENT_STEPS: DeploymentRequirementStep[] = [
  "provision",
  "publish",
  "preview_cleanup",
  "smoke",
  "release_actions.pre_publish",
  "release_actions.post_publish_pre_smoke",
  "release_actions.post_smoke",
];

export type DeploymentRequirement = {
  name: string;
  step: DeploymentRequirementStep;
  contractId: string;
  required: boolean;
  source?: string;
  previewVariant?: string;
  notes?: string;
};

function readStringRecordList(node: GraphNode, key: string): Record<string, string>[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(
            ([entryKey, entryValue]) =>
              typeof entryKey === "string" &&
              (typeof entryValue === "string" || typeof entryValue === "boolean"),
          )
          .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
          .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
      );
    })
    .filter((entry): entry is Record<string, string> => !!entry);
}

function readRequiredFlag(value: string): boolean {
  return value === "true";
}

function requirement(fieldPath: string, entry: Record<string, string>): DeploymentRequirement {
  return {
    name: entry.name || "",
    step: (entry.step || "") as DeploymentRequirementStep,
    contractId: entry.contract_id || "",
    required: readRequiredFlag(entry.required || ""),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.preview_variant ? { previewVariant: entry.preview_variant } : {}),
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

export function readDeploymentRequirements(node: GraphNode, key: string): DeploymentRequirement[] {
  return readStringRecordList(node, key).map((entry) => requirement(key, entry));
}

function requirementKey(requirement: DeploymentRequirement): string {
  return JSON.stringify([
    requirement.name,
    requirement.step,
    requirement.contractId,
    requirement.required,
    requirement.source || "",
    requirement.previewVariant || "",
  ]);
}

export function requirementContractIds(requirements: DeploymentRequirement[]): string[] {
  return requirements
    .map((requirement) => requirement.contractId)
    .sort((a, b) => a.localeCompare(b));
}

export function requirementNames(requirements: DeploymentRequirement[]): string[] {
  return requirements.map((requirement) => requirement.name);
}

export function missingRequirementNames(
  requirements: DeploymentRequirement[],
  requiredNames: string[],
): string[] {
  const available = new Set(requirementNames(requirements));
  return requiredNames.filter((name) => !available.has(name)).sort((a, b) => a.localeCompare(b));
}

export function sameRequirementSet(
  left: DeploymentRequirement[],
  right: DeploymentRequirement[],
): boolean {
  const leftKeys = new Set(left.map(requirementKey));
  const rightKeys = new Set(right.map(requirementKey));
  if (leftKeys.size !== rightKeys.size) return false;
  for (const key of leftKeys) {
    if (!rightKeys.has(key)) return false;
  }
  return true;
}

export function requirementSummary(requirements: DeploymentRequirement[]): string {
  return requirements
    .map((requirement) => `${requirement.name}:${requirement.step}:${requirement.contractId}`)
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

function requirementError(label: string, fieldPath: string, message: string): string {
  return `${label}: ${fieldPath}: ${message}`;
}

function isDeploymentRequirementStep(step: string): step is DeploymentRequirementStep {
  return DEPLOYMENT_REQUIREMENT_STEPS.includes(step as DeploymentRequirementStep);
}

export function validateDeploymentRequirements(opts: {
  label: string;
  fieldPath: string;
  requirements: DeploymentRequirement[];
  errors: string[];
}) {
  const seenNames = new Set<string>();
  for (const requirement of opts.requirements) {
    const seenKey = `${requirement.name}:${requirement.step}`;
    if (!requirement.name) {
      opts.errors.push(requirementError(opts.label, opts.fieldPath, "entries must set name"));
      continue;
    }
    if (seenNames.has(seenKey)) {
      opts.errors.push(
        requirementError(
          opts.label,
          opts.fieldPath,
          `duplicate requirement "${requirement.name}" for step "${requirement.step}"`,
        ),
      );
    }
    seenNames.add(seenKey);
    if (!requirement.step) {
      opts.errors.push(
        requirementError(opts.label, opts.fieldPath, `${requirement.name} must set step`),
      );
    } else if (!isDeploymentRequirementStep(requirement.step)) {
      opts.errors.push(
        requirementError(
          opts.label,
          opts.fieldPath,
          `${requirement.name} has unsupported step "${requirement.step}"`,
        ),
      );
    }
    if (!requirement.contractId) {
      opts.errors.push(
        requirementError(opts.label, opts.fieldPath, `${requirement.name} must set contract_id`),
      );
    }
  }
}
