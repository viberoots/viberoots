import process from "node:process";
import { activateNixCachePolicyCapabilityAfterCanonicalEntry } from "../../lib/nix-cache-policy-capability";
import type { NixCachePolicy } from "./nix-cache-health-config";
import type { CacheHealthResult } from "./nix-cache-health";

type ReviewedCacheCapability = {
  kind: "reviewed";
  config: string;
  policy: "auto" | "strict";
  requiredSubstituters: string[];
  optionalSubstituters: string[];
};

export function activateReviewedCacheCapability(outcome: ReviewedCacheCapability): void {
  if (process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT === "1") {
    activateNixCachePolicyCapabilityAfterCanonicalEntry(process.env, outcome);
  }
}

export function clearReviewedCacheEnvironment(): void {
  delete process.env.VBR_NIX_CACHE_HEALTH_APPLIED;
  delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS;
  delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS;
  delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY;
}

export function recordReviewedCacheResult(
  result: CacheHealthResult,
  required: string[],
  optional: string[],
  policy: NixCachePolicy,
): CacheHealthResult {
  result.requiredSubstituters = [...required];
  result.optionalSubstituters = [...optional];
  process.env.VBR_NIX_CACHE_HEALTH_APPLIED = "1";
  process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = result.nixConfig;
  process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS = required.join(" ");
  process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS = optional.join(" ");
  process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY = policy;
  if (policy !== "off") {
    activateReviewedCacheCapability({
      kind: "reviewed",
      config: result.nixConfig,
      policy,
      requiredSubstituters: required,
      optionalSubstituters: optional,
    });
  }
  return result;
}
