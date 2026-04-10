#!/usr/bin/env zx-wrapper
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import type { DeploymentRetryAudit } from "./deployment-retry-policy.ts";
import type { DeploymentSmokeBudget } from "./deployment-smoke-budget.ts";

export function retryAuditFrom(error: unknown): DeploymentRetryAudit {
  return (error as any).retryAudit;
}

export function executionPolicyWithRetry(opts: {
  budget: DeploymentSmokeBudget;
  prior?: DeploymentExecutionPolicyFacts;
  retryAudit?: DeploymentRetryAudit;
}): DeploymentExecutionPolicyFacts {
  return {
    smokeBudget: opts.budget,
    retries: [...(opts.prior?.retries || []), ...(opts.retryAudit ? [opts.retryAudit] : [])],
  };
}
