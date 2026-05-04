#!/usr/bin/env zx-wrapper
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy";
import type { DeploymentRetryAudit } from "./deployment-retry-policy";
import type { DeploymentSmokeBudget } from "./deployment-smoke-budget";

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
