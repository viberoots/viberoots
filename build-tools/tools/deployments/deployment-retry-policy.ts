#!/usr/bin/env zx-wrapper
export type DeploymentLifecycleStep =
  | "validate"
  | "build"
  | "resolve"
  | "provision"
  | "publish"
  | "smoke";

export type DeploymentRetryReasonCode =
  | "non_retryable_step"
  | "publish_not_proven_safe"
  | "publish_transient_idempotent"
  | "smoke_readiness_transient"
  | "smoke_network_transient"
  | "budget_exhausted"
  | "retry_limit_reached"
  | "non_retryable_error";

export type DeploymentRetryAttempt = {
  attempt: number;
  outcome: "retried" | "failed" | "succeeded";
  reasonCode: DeploymentRetryReasonCode;
  message?: string;
  backoffMs?: number;
};

export type DeploymentRetryAudit = {
  step: DeploymentLifecycleStep;
  maxRetries: number;
  totalAttempts: number;
  retriesUsed: number;
  exhaustedBudget: boolean;
  attempts: DeploymentRetryAttempt[];
};

export type DeploymentRetryDecision = {
  retryable: boolean;
  reasonCode: DeploymentRetryReasonCode;
  backoffMs?: number;
};

const NEVER_AUTO_RETRY = new Set<DeploymentLifecycleStep>([
  "validate",
  "build",
  "resolve",
  "provision",
]);

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return await promise;
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`timeout budget exhausted after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function defaultMaxRetriesForStep(step: DeploymentLifecycleStep): number {
  return NEVER_AUTO_RETRY.has(step) ? 0 : 2;
}

export function classifySmokeRetry(error: unknown, attempt: number): DeploymentRetryDecision {
  const message = messageFor(error);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return {
      retryable: true,
      reasonCode: "smoke_network_transient",
      backoffMs: attempt * 100,
    };
  }
  if (/smoke expected 200|smoke content mismatch/i.test(message)) {
    return {
      retryable: true,
      reasonCode: "smoke_readiness_transient",
      backoffMs: attempt * 100,
    };
  }
  return { retryable: false, reasonCode: "non_retryable_error" };
}

export function noPublishAutoRetry(): DeploymentRetryDecision {
  return { retryable: false, reasonCode: "publish_not_proven_safe" };
}

export async function runWithAutomaticRetry<T>(opts: {
  step: DeploymentLifecycleStep;
  run: () => Promise<T>;
  classifyError: (error: unknown, attempt: number) => DeploymentRetryDecision;
  maxRetries?: number;
  totalBudgetMs?: number;
}): Promise<{ result: T; audit: DeploymentRetryAudit }> {
  const maxRetries = opts.maxRetries ?? defaultMaxRetriesForStep(opts.step);
  const startedAt = Date.now();
  const attempts: DeploymentRetryAttempt[] = [];
  let attempt = 0;
  while (true) {
    attempt += 1;
    const elapsedMs = Date.now() - startedAt;
    const remainingBudgetMs =
      opts.totalBudgetMs === undefined ? undefined : Math.max(opts.totalBudgetMs - elapsedMs, 0);
    try {
      const result = await withTimeout(opts.run(), remainingBudgetMs);
      attempts.push({
        attempt,
        outcome: "succeeded",
        reasonCode:
          attempt > 1 ? ("smoke_readiness_transient" as const) : ("non_retryable_step" as const),
      });
      return {
        result,
        audit: {
          step: opts.step,
          maxRetries,
          totalAttempts: attempt,
          retriesUsed: attempt - 1,
          exhaustedBudget: false,
          attempts,
        },
      };
    } catch (error) {
      const decision = opts.classifyError(error, attempt);
      const retriesUsed = attempt - 1;
      const retryLimitReached = retriesUsed >= maxRetries;
      const nextBackoffMs = decision.backoffMs || 0;
      const nextElapsedMs = Date.now() - startedAt;
      const exhaustedBudget =
        opts.totalBudgetMs !== undefined && nextElapsedMs + nextBackoffMs >= opts.totalBudgetMs;
      if (!decision.retryable || retryLimitReached || exhaustedBudget) {
        attempts.push({
          attempt,
          outcome: "failed",
          reasonCode: exhaustedBudget
            ? "budget_exhausted"
            : retryLimitReached
              ? "retry_limit_reached"
              : decision.reasonCode,
          message: messageFor(error),
        });
        throw Object.assign(error instanceof Error ? error : new Error(messageFor(error)), {
          retryAudit: {
            step: opts.step,
            maxRetries,
            totalAttempts: attempt,
            retriesUsed,
            exhaustedBudget,
            attempts,
          } satisfies DeploymentRetryAudit,
        });
      }
      attempts.push({
        attempt,
        outcome: "retried",
        reasonCode: decision.reasonCode,
        message: messageFor(error),
        ...(nextBackoffMs > 0 ? { backoffMs: nextBackoffMs } : {}),
      });
      if (nextBackoffMs > 0) await sleep(nextBackoffMs);
    }
  }
}
