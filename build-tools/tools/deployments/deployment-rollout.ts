#!/usr/bin/env zx-wrapper
export type DeploymentRolloutMode =
  | "all_at_once"
  | "all_or_nothing"
  | "ordered_best_effort"
  | "parallel_best_effort"
  | "phased"
  | "canary"
  | "blue_green"
  | "store_staged";

export type DeploymentRolloutAbortBehavior = "stop_on_first_failure";
export type DeploymentRolloutSmokeMode = "per_phase" | "final_only" | "both";

export type DeploymentRolloutPolicy = {
  mode: DeploymentRolloutMode;
  abort: DeploymentRolloutAbortBehavior;
  smoke: DeploymentRolloutSmokeMode;
  steps: string[];
};

export const DEPLOYMENT_ROLLOUT_MODES = new Set<DeploymentRolloutMode>([
  "all_at_once",
  "all_or_nothing",
  "ordered_best_effort",
  "parallel_best_effort",
  "phased",
  "canary",
  "blue_green",
  "store_staged",
]);

export const DEPLOYMENT_ROLLOUT_ABORT_BEHAVIORS = new Set<DeploymentRolloutAbortBehavior>([
  "stop_on_first_failure",
]);

export const DEPLOYMENT_ROLLOUT_SMOKE_MODES = new Set<DeploymentRolloutSmokeMode>([
  "per_phase",
  "final_only",
  "both",
]);
