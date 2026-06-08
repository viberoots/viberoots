#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { normalizeTargetLabel } from "../lib/labels";
import { readString, readStringRecord } from "./deployment-graph-readers";
import { resolveDeploymentContextNodes } from "./deployment-contexts";
import type {
  DeploymentPrerequisite,
  DeploymentPrerequisiteMode,
  DeploymentPreviewIdentitySelector,
  DeploymentPreviewPolicy,
} from "./contract-types";
import {
  extractDeploymentReleaseActions,
  type DeploymentReleaseAction,
} from "./deployment-release-actions";
import {
  extractDeploymentTargetExceptions,
  type DeploymentTargetException,
} from "./deployment-target-exceptions";
import {
  DEPLOYMENT_ROLLOUT_ABORT_BEHAVIORS,
  DEPLOYMENT_ROLLOUT_MODES,
  DEPLOYMENT_ROLLOUT_SMOKE_MODES,
  type DeploymentRolloutPolicy,
} from "./deployment-rollout";
import {
  extractDeploymentAdmissionPolicies,
  extractDeploymentLanePoliciesWithGovernance,
  type DeploymentAdmissionPolicy,
  type DeploymentLanePolicy,
} from "./deployment-policy";
import { extractDeploymentLaneGovernancePolicies } from "./deployment-lane-governance";
import { readDeploymentSmokePolicy, type DeploymentSmokePolicy } from "./deployment-smoke-policy";
export type DeploymentExtractionContext = {
  nodes: GraphNode[];
  components: Map<string, GraphNode>;
  lanePolicies: Map<string, DeploymentLanePolicy>;
  admissionPolicies: Map<string, DeploymentAdmissionPolicy>;
  releaseActions: Map<string, DeploymentReleaseAction>;
  targetExceptions: Map<string, DeploymentTargetException>;
  errors: string[];
};

export function readLabel(node: GraphNode, key: string): string {
  return normalizeTargetLabel(readString(node, key));
}
export { readString, readStringRecord };

export function readStringRecordList(node: GraphNode, key: string): Record<string, string>[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(
            ([entryKey, entryValue]) =>
              typeof entryKey === "string" && typeof entryValue === "string",
          )
          .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
          .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
      );
    })
    .filter((entry): entry is Record<string, string> => !!entry);
}

export function readLabelList(node: GraphNode, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string"
        ? normalizeTargetLabel(entry)
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { label?: unknown }).label === "string"
          ? normalizeTargetLabel(String((entry as { label: string }).label))
          : "",
    )
    .filter(Boolean);
}

export function readPreviewPolicy(
  node: GraphNode,
  key: string,
): DeploymentPreviewPolicy | undefined {
  const preview = readStringRecord(node, key);
  if (Object.keys(preview).length === 0) return undefined;
  return {
    targetDerivation: preview.target_derivation || "",
    isolationClass: preview.isolation_class || "",
    identitySelector: (preview.identity_selector || "") as DeploymentPreviewIdentitySelector,
    cleanupTtl: preview.cleanup_ttl || "7d",
    smokeTarget: (preview.smoke_target || "normal_url") as "normal_url" | "preview_url",
    lockScope: (preview.lock_scope || "shared") as "shared" | "preview",
  };
}

export function readSmokePolicy(node: GraphNode): DeploymentSmokePolicy | undefined {
  return readDeploymentSmokePolicy(node);
}

export function readRolloutPolicy(node: GraphNode): DeploymentRolloutPolicy | undefined {
  const rollout = readStringRecord(node, "rollout_policy");
  if (Object.keys(rollout).length === 0) return undefined;
  const steps = Array.isArray(node.rollout_steps)
    ? node.rollout_steps.filter(
        (step): step is string => typeof step === "string" && step.trim() !== "",
      )
    : [];
  return {
    mode: (rollout.mode || "") as DeploymentRolloutPolicy["mode"],
    abort: (rollout.abort || "") as DeploymentRolloutPolicy["abort"],
    smoke: (rollout.smoke || "") as DeploymentRolloutPolicy["smoke"],
    steps,
  };
}

export function readPrerequisites(node: GraphNode, key: string): DeploymentPrerequisite[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const prerequisite = entry as Record<string, unknown>;
      const deploymentId =
        typeof prerequisite.deployment_id === "string" ? prerequisite.deployment_id.trim() : "";
      const mode =
        typeof prerequisite.mode === "string"
          ? (prerequisite.mode.trim() as DeploymentPrerequisiteMode)
          : ("" as DeploymentPrerequisiteMode);
      if (!deploymentId || !mode) return null;
      return { deploymentId, mode };
    })
    .filter((entry): entry is DeploymentPrerequisite => !!entry);
}

export function deploymentError(label: string, message: string): string {
  return `${normalizeTargetLabel(label)}: ${message}`;
}

export function pushRolloutPolicyFieldErrors(opts: {
  errors: string[];
  label: string;
  rolloutPolicy?: DeploymentRolloutPolicy;
}) {
  const rolloutPolicy = opts.rolloutPolicy;
  if (!rolloutPolicy) return;
  if (!DEPLOYMENT_ROLLOUT_MODES.has(rolloutPolicy.mode)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported rollout_policy.mode "${rolloutPolicy.mode || "<empty>"}"`,
      ),
    );
  }
  if (!DEPLOYMENT_ROLLOUT_ABORT_BEHAVIORS.has(rolloutPolicy.abort)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported rollout_policy.abort "${rolloutPolicy.abort || "<empty>"}"`,
      ),
    );
  }
  if (!DEPLOYMENT_ROLLOUT_SMOKE_MODES.has(rolloutPolicy.smoke)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported rollout_policy.smoke "${rolloutPolicy.smoke || "<empty>"}"`,
      ),
    );
  }
}

export function pushTokenFieldErrors(opts: {
  errors: string[];
  label: string;
  fieldPath: string;
  value: string;
  pattern: RegExp;
  required?: boolean;
  invalidMessage: string;
}) {
  if (!opts.value) {
    if (opts.required !== false) {
      opts.errors.push(deploymentError(opts.label, `${opts.fieldPath} is required`));
    }
    return;
  }
  if (opts.pattern.test(opts.value)) return;
  opts.errors.push(deploymentError(opts.label, opts.invalidMessage));
}

export function createDeploymentExtractionContext(
  nodes: GraphNode[],
  opts: { workspaceRoot?: string } = {},
): DeploymentExtractionContext {
  const contextErrors: string[] = [];
  const resolvedNodes = resolveDeploymentContextNodes(nodes, contextErrors, opts.workspaceRoot);
  const { policies: laneGovernancePolicies, errors: laneGovernanceErrors } =
    extractDeploymentLaneGovernancePolicies(resolvedNodes);
  const { policies: lanePolicies, errors: laneErrors } =
    extractDeploymentLanePoliciesWithGovernance(resolvedNodes, laneGovernancePolicies);
  const { policies: admissionPolicies, errors: admissionErrors } =
    extractDeploymentAdmissionPolicies(resolvedNodes);
  const { actions: releaseActions, errors: releaseActionErrors } =
    extractDeploymentReleaseActions(resolvedNodes);
  const { exceptions: targetExceptions, errors: targetExceptionErrors } =
    extractDeploymentTargetExceptions(resolvedNodes);
  const components = new Map<string, GraphNode>();
  for (const node of resolvedNodes) {
    const label = normalizeTargetLabel(String(node.name || ""));
    if (label) components.set(label, node);
  }
  return {
    nodes: resolvedNodes,
    components,
    lanePolicies,
    admissionPolicies,
    releaseActions,
    targetExceptions,
    errors: [
      ...contextErrors,
      ...laneGovernanceErrors,
      ...laneErrors,
      ...admissionErrors,
      ...releaseActionErrors,
      ...targetExceptionErrors,
    ],
  };
}

export function uniqueErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

export function duplicateValueEntries(
  values: Array<{ value: string; label: string }>,
): Array<{ value: string; labels: string[] }> {
  const labelsByValue = new Map<string, string[]>();
  for (const entry of values) {
    const labels = labelsByValue.get(entry.value) || [];
    labels.push(entry.label);
    labelsByValue.set(entry.value, labels);
  }
  return Array.from(labelsByValue.entries())
    .filter(([, labels]) => labels.length > 1)
    .map(([value, labels]) => ({ value, labels: [...labels].sort() }));
}
