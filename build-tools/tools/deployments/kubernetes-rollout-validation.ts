#!/usr/bin/env zx-wrapper
import { deploymentError, pushRolloutPolicyFieldErrors } from "./contract-extract-shared.ts";
import type { KubernetesDeployment } from "./contract-types.ts";

const SHARED_PROTECTION_CLASSES = new Set(["shared_nonprod", "production_facing"]);

export function pushKubernetesRolloutErrors(opts: {
  label: string;
  protectionClass: string;
  componentIds: string[];
  rolloutPolicy?: KubernetesDeployment["rolloutPolicy"];
  errors: string[];
}) {
  pushRolloutPolicyFieldErrors(opts);
  if (opts.componentIds.length < 2) {
    if (opts.rolloutPolicy && opts.rolloutPolicy.mode !== "all_at_once") {
      opts.errors.push(
        deploymentError(
          opts.label,
          'single-component kubernetes deployments only support rollout_policy.mode "all_at_once"',
        ),
      );
    }
    return;
  }
  if (!opts.rolloutPolicy) {
    if (SHARED_PROTECTION_CLASSES.has(opts.protectionClass)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          "protected/shared multi-component kubernetes deployments must set rollout_policy",
        ),
      );
    }
    return;
  }
  if (opts.rolloutPolicy.mode !== "ordered_best_effort") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'multi-component kubernetes deployments only support rollout_policy.mode "ordered_best_effort"',
      ),
    );
  }
  if (opts.rolloutPolicy.abort !== "stop_on_first_failure") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'multi-component kubernetes deployments only support rollout_policy.abort "stop_on_first_failure"',
      ),
    );
  }
  if (opts.rolloutPolicy.smoke !== "final_only") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'multi-component kubernetes deployments only support rollout_policy.smoke "final_only"',
      ),
    );
  }
  const expected = new Set(opts.componentIds);
  const actual = new Set(opts.rolloutPolicy.steps);
  if (
    expected.size !== actual.size ||
    [...expected].some((componentId) => !actual.has(componentId))
  ) {
    opts.errors.push(
      deploymentError(opts.label, "rollout_policy.steps must list every component id exactly once"),
    );
  }
}
