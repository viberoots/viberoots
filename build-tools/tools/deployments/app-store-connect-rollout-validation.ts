#!/usr/bin/env zx-wrapper
import { deploymentError, pushRolloutPolicyFieldErrors } from "./contract-extract-shared.ts";
import type { AppStoreConnectDeployment } from "./contract-types.ts";

export function pushAppStoreConnectRolloutErrors(opts: {
  label: string;
  rolloutPolicy?: AppStoreConnectDeployment["rolloutPolicy"];
  errors: string[];
}) {
  pushRolloutPolicyFieldErrors(opts);
  if (!opts.rolloutPolicy) return;
  if (!["all_at_once", "store_staged"].includes(opts.rolloutPolicy.mode)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        'app-store-connect deployments only support rollout_policy.mode "all_at_once" or "store_staged"',
      ),
    );
  }
  if (opts.rolloutPolicy.abort !== "stop_on_first_failure") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'app-store-connect deployments only support rollout_policy.abort "stop_on_first_failure"',
      ),
    );
  }
  if (opts.rolloutPolicy.smoke !== "final_only") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'app-store-connect deployments only support rollout_policy.smoke "final_only"',
      ),
    );
  }
  if (opts.rolloutPolicy.steps.length > 0 && opts.rolloutPolicy.steps.join(",") !== "default") {
    opts.errors.push(
      deploymentError(
        opts.label,
        'app-store-connect rollout_policy.steps may be omitted or set to ["default"] only',
      ),
    );
  }
}
