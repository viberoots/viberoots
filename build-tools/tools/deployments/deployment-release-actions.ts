#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";

export const DEPLOYMENT_RELEASE_ACTION_RULE = "deployment_release_action";
export const DEPLOYMENT_RELEASE_ACTION_PHASES = new Set([
  "pre_publish",
  "post_publish_pre_smoke",
  "post_smoke",
]);
export const DEPLOYMENT_RELEASE_ACTION_RUN_CONDITIONS = new Set([
  "success_only",
  "failure_only",
  "always",
]);
export const DEPLOYMENT_RELEASE_ACTION_ABORT_BEHAVIORS = new Set(["fail_run", "continue"]);
export const DEPLOYMENT_RELEASE_ACTION_REPLAY_CONTEXTS = [
  "deploy_publish_slice",
  "retry",
  "rollback",
  "promotion",
] as const;
export const DEPLOYMENT_RELEASE_ACTION_REPLAY_DISPOSITIONS = new Set(["rerun", "skip", "fail"]);
export const DEPLOYMENT_RELEASE_ACTION_DUPLICATE_SAFETY = new Set([
  "provider_idempotent",
  "control_plane_deduplicated",
  "not_duplicate_safe",
]);
export const DEPLOYMENT_RELEASE_ACTION_DATA_COMPATIBILITY = new Set([
  "backward_compatible",
  "forward_only",
  "reversible",
  "manual_recovery_required",
]);
export const NIXOS_SHARED_HOST_RELEASE_ACTION_TYPES = new Set([
  "cache_warmup",
  "schema_migration",
  "post_publish_verification",
]);
const DESTRUCTIVE_RELEASE_ACTION_TYPES = new Set(["schema_migration"]);

export type DeploymentReleaseActionReplayContext =
  (typeof DEPLOYMENT_RELEASE_ACTION_REPLAY_CONTEXTS)[number];

export type DeploymentReleaseAction = {
  ref: string;
  type: string;
  phase: "pre_publish" | "post_publish_pre_smoke" | "post_smoke";
  runCondition: "success_only" | "failure_only" | "always";
  abortBehavior: "fail_run" | "continue";
  dataCompatibility:
    | "backward_compatible"
    | "forward_only"
    | "reversible"
    | "manual_recovery_required";
  replayPolicy: Record<DeploymentReleaseActionReplayContext, "rerun" | "skip" | "fail">;
  duplicateSafety: Partial<
    Record<
      DeploymentReleaseActionReplayContext,
      "provider_idempotent" | "control_plane_deduplicated" | "not_duplicate_safe"
    >
  >;
  operationKeys: Partial<Record<DeploymentReleaseActionReplayContext, string>>;
  requiredSecretRequirementNames: string[];
  requiredRuntimeConfigRequirementNames: string[];
};

function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

function readStringArray(node: GraphNode, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function readStringRecord(node: GraphNode, key: string): Record<string, string> {
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "string",
      )
      .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
      .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
  );
}

function actionError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function extractDeploymentReleaseActions(nodes: GraphNode[]): {
  actions: Map<string, DeploymentReleaseAction>;
  errors: string[];
} {
  const actions = new Map<string, DeploymentReleaseAction>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_RELEASE_ACTION_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const replayPolicy = readStringRecord(node, "replay_policy");
    const duplicateSafety = readStringRecord(node, "duplicate_safety");
    const operationKeys = readStringRecord(node, "operation_keys");
    const action: DeploymentReleaseAction = {
      ref,
      type: readString(node, "type"),
      phase: readString(node, "phase") as DeploymentReleaseAction["phase"],
      runCondition: readString(node, "run_condition") as DeploymentReleaseAction["runCondition"],
      abortBehavior: readString(node, "abort_behavior") as DeploymentReleaseAction["abortBehavior"],
      dataCompatibility: readString(
        node,
        "data_compatibility",
      ) as DeploymentReleaseAction["dataCompatibility"],
      replayPolicy: Object.fromEntries(
        DEPLOYMENT_RELEASE_ACTION_REPLAY_CONTEXTS.map((context) => [
          context,
          replayPolicy[context] || "",
        ]),
      ) as DeploymentReleaseAction["replayPolicy"],
      duplicateSafety: duplicateSafety as DeploymentReleaseAction["duplicateSafety"],
      operationKeys,
      requiredSecretRequirementNames: readStringArray(node, "required_secret_requirements"),
      requiredRuntimeConfigRequirementNames: readStringArray(
        node,
        "required_runtime_config_requirements",
      ),
    };
    if (!ref) {
      errors.push("deployment release action missing canonical label");
      continue;
    }
    if (!action.type) errors.push(actionError(ref, "release action must set type"));
    if (!DEPLOYMENT_RELEASE_ACTION_PHASES.has(action.phase)) {
      errors.push(
        actionError(ref, `unsupported release-action phase "${action.phase || "<empty>"}"`),
      );
    }
    if (!DEPLOYMENT_RELEASE_ACTION_RUN_CONDITIONS.has(action.runCondition)) {
      errors.push(
        actionError(ref, `unsupported run_condition "${action.runCondition || "<empty>"}"`),
      );
    }
    if (!DEPLOYMENT_RELEASE_ACTION_ABORT_BEHAVIORS.has(action.abortBehavior)) {
      errors.push(
        actionError(ref, `unsupported abort_behavior "${action.abortBehavior || "<empty>"}"`),
      );
    }
    if (!DEPLOYMENT_RELEASE_ACTION_DATA_COMPATIBILITY.has(action.dataCompatibility)) {
      errors.push(
        actionError(
          ref,
          `unsupported data_compatibility "${action.dataCompatibility || "<empty>"}"`,
        ),
      );
    }
    for (const context of DEPLOYMENT_RELEASE_ACTION_REPLAY_CONTEXTS) {
      const disposition = action.replayPolicy[context];
      if (!DEPLOYMENT_RELEASE_ACTION_REPLAY_DISPOSITIONS.has(disposition)) {
        errors.push(actionError(ref, `replay_policy.${context} must be rerun, skip, or fail`));
        continue;
      }
      if (disposition !== "rerun") continue;
      const safety = action.duplicateSafety[context];
      if (!safety || !DEPLOYMENT_RELEASE_ACTION_DUPLICATE_SAFETY.has(safety)) {
        errors.push(
          actionError(
            ref,
            `duplicate_safety.${context} is required when replay_policy.${context} = rerun`,
          ),
        );
        continue;
      }
      if (safety === "not_duplicate_safe") {
        errors.push(
          actionError(
            ref,
            `duplicate_safety.${context} must not be not_duplicate_safe when replay_policy.${context} = rerun`,
          ),
        );
      }
      if (!action.operationKeys[context]) {
        errors.push(
          actionError(
            ref,
            `operation_keys.${context} is required when replay_policy.${context} = rerun`,
          ),
        );
      }
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    actions.set(ref, action);
  }
  return { actions, errors };
}

export function releaseActionRefs(actions: DeploymentReleaseAction[]): string[] {
  return actions.map((action) => action.ref).sort((a, b) => a.localeCompare(b));
}

export function destructiveReleaseActions(
  actions: DeploymentReleaseAction[],
): DeploymentReleaseAction[] {
  return actions.filter((action) => DESTRUCTIVE_RELEASE_ACTION_TYPES.has(action.type));
}
