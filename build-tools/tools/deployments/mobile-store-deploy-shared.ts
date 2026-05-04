#!/usr/bin/env zx-wrapper
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy";
import { noPublishAutoRetry, runWithAutomaticRetry } from "./deployment-retry-policy";

export async function publishWithFailClosedRetry<T>(run: () => Promise<T>): Promise<{
  result: T;
  executionPolicy: DeploymentExecutionPolicyFacts;
}> {
  return await runWithAutomaticRetry({
    step: "publish",
    run,
    classifyError: () => noPublishAutoRetry(),
  })
    .then((outcome) => ({
      result: outcome.result,
      executionPolicy: { retries: [outcome.audit] },
    }))
    .catch((error) => {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        executionPolicy: {
          retries: [(error as any).retryAudit],
        } satisfies DeploymentExecutionPolicyFacts,
      });
    });
}

export function mergeExecutionPolicyFacts(
  base: DeploymentExecutionPolicyFacts | undefined,
  next: DeploymentExecutionPolicyFacts | undefined,
): DeploymentExecutionPolicyFacts | undefined {
  if (!base) return next;
  if (!next) return base;
  return {
    ...(next.smokeBudget
      ? { smokeBudget: next.smokeBudget }
      : base.smokeBudget
        ? { smokeBudget: base.smokeBudget }
        : {}),
    retries: [...(base.retries || []), ...(next.retries || [])],
  };
}
