#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability } from "./types.ts";
import { validateCapability } from "./validate-capability.ts";

export function validateProviderCapabilityRegistry(
  registry: Record<string, DeploymentProviderCapability>,
): void {
  const errors = Object.entries(registry).flatMap(([provider, capability]) =>
    validateCapability(provider, capability),
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
