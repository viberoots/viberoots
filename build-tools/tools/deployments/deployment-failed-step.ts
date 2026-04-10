#!/usr/bin/env zx-wrapper
export function withFailedStep<TStep extends string>(
  step: TStep,
  error: unknown,
): Error & { failedStep: TStep } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { failedStep: step });
}
