#!/usr/bin/env zx-wrapper
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import { classifySmokeRetry, runWithAutomaticRetry } from "./deployment-retry-policy.ts";

type SecretRuntime = { enterStep(step: "smoke"): Promise<Record<string, string>> };

export async function evaluateMobileStoreReleaseHealth(opts: {
  secretRuntime: SecretRuntime;
  smokeMode: {
    mode: "blocking" | "nonblocking" | "omitted";
    budget?: { totalBudgetMs?: number };
  };
  assertHealthy: () => void;
}): Promise<
  | {
      smokeOutcome: "passed" | "omitted_by_exception";
      executionPolicy?: DeploymentExecutionPolicyFacts;
    }
  | {
      smokeOutcome: "failed_nonblocking";
      smokeError: string;
      executionPolicy?: DeploymentExecutionPolicyFacts;
    }
> {
  if (opts.smokeMode.mode === "omitted") {
    return {
      smokeOutcome: "omitted_by_exception" as const,
      executionPolicy: opts.smokeMode.budget ? { smokeBudget: opts.smokeMode.budget } : undefined,
    };
  }
  try {
    await opts.secretRuntime.enterStep("smoke");
    const health = await runWithAutomaticRetry({
      step: "smoke",
      totalBudgetMs: opts.smokeMode.budget?.totalBudgetMs,
      run: async () => {
        opts.assertHealthy();
      },
      classifyError: classifySmokeRetry,
    });
    return {
      smokeOutcome: "passed" as const,
      executionPolicy: opts.smokeMode.budget
        ? { smokeBudget: opts.smokeMode.budget, retries: [health.audit] }
        : { retries: [health.audit] },
    };
  } catch (error) {
    if (opts.smokeMode.mode !== "nonblocking") throw error;
    return {
      smokeOutcome: "failed_nonblocking" as const,
      smokeError: error instanceof Error ? error.message : String(error),
      executionPolicy: {
        ...(opts.smokeMode.budget ? { smokeBudget: opts.smokeMode.budget } : {}),
        retries: [(error as any).retryAudit],
      },
    };
  }
}
