#!/usr/bin/env zx-wrapper
import type { DeploymentRetryAudit } from "./deployment-retry-policy.ts";
import type { DeploymentSmokeBudget } from "./deployment-smoke-policy.ts";

export type DeploymentExecutionPolicyFacts = {
  smokeBudget?: DeploymentSmokeBudget;
  retries?: DeploymentRetryAudit[];
};
