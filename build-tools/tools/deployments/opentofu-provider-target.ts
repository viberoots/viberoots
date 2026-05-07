#!/usr/bin/env zx-wrapper
import { OPENTOFU_PROVIDER } from "./deployment-provider-targets";

export type OpenTofuProviderTarget = {
  stackIdentity: string;
  stateBackendIdentity: string;
  providerTargetIdentity: string;
  allowedEnvironmentDifferences?: string[];
};

export function deriveOpenTofuProviderTarget(input: {
  stackIdentity: string;
  stateBackendIdentity: string;
  allowedEnvironmentDifferences?: string[];
}): OpenTofuProviderTarget {
  const stackIdentity = input.stackIdentity.trim();
  const stateBackendIdentity = input.stateBackendIdentity.trim();
  return {
    stackIdentity,
    stateBackendIdentity,
    providerTargetIdentity: `${OPENTOFU_PROVIDER}:${stackIdentity}#state:${stateBackendIdentity}`,
    ...(input.allowedEnvironmentDifferences?.length
      ? { allowedEnvironmentDifferences: [...input.allowedEnvironmentDifferences] }
      : {}),
  };
}
