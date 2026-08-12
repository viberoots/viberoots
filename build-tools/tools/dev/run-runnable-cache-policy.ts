import {
  maybeCurrentNixCachePolicyCapability,
  outcomeFromNixCachePolicyCapability,
  type NixCachePolicyCapability,
} from "../lib/nix-cache-policy-capability";

export function runnableNixCachePolicyCapability(): NixCachePolicyCapability | undefined {
  return maybeCurrentNixCachePolicyCapability();
}

export function runnableNixCacheConfig(
  capability: NixCachePolicyCapability | undefined,
): string | undefined {
  if (!capability) return undefined;
  const outcome = outcomeFromNixCachePolicyCapability(capability);
  return outcome.kind === "reviewed" ? outcome.config : undefined;
}
