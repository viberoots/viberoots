#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability } from "./types.ts";
import { validateReviewedRuntimeParity } from "./runtime-parity.ts";
import { validateCapability } from "./validate-capability.ts";

export function validateProviderCapabilityRegistry(
  registry: Record<string, DeploymentProviderCapability>,
): void {
  const errors = Object.entries(registry).flatMap(([provider, capability]) => [
    ...validateCapability(provider, capability),
    ...((provider === "s3-static" || provider === "kubernetes" || provider === "vercel") &&
    (capability.provider === "s3-static" ||
      capability.provider === "kubernetes" ||
      capability.provider === "vercel")
      ? validateReviewedRuntimeParity({
          provider: capability.provider,
          capability,
        })
      : []),
  ]);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
