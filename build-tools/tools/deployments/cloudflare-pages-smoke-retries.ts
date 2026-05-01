#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";

const SMOKE_RETRY_LINEAR_BACKOFF_MS = 100;

export function shouldUseCloudflarePagesCustomDomainSmokeBudget(opts: {
  effectiveRunTarget: CloudflarePagesDeployment["providerTarget"];
}): boolean {
  const customDomain = opts.effectiveRunTarget.customDomain?.trim();
  if (!customDomain) return false;
  return new URL(opts.effectiveRunTarget.canonicalUrl).hostname === customDomain;
}

export function maxCloudflarePagesCustomDomainSmokeRetries(
  smokeTimeoutMs: number | undefined,
): number | undefined {
  if (!smokeTimeoutMs || smokeTimeoutMs <= 0) return undefined;
  const budgetBoundRetries = Math.floor(
    (Math.sqrt(1 + (8 * smokeTimeoutMs) / SMOKE_RETRY_LINEAR_BACKOFF_MS) - 1) / 2,
  );
  return Math.max(2, budgetBoundRetries);
}
