#!/usr/bin/env zx-wrapper
import type { DeploymentRetryAudit } from "./deployment-retry-policy";
import type { DeploymentSmokeBudget } from "./deployment-smoke-policy";

export type DeploymentExecutionPolicyFacts = {
  smokeBudget?: DeploymentSmokeBudget;
  retries?: DeploymentRetryAudit[];
};
