#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";

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
  return Math.max(2, Math.ceil(smokeTimeoutMs / 5000));
}
