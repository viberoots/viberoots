#!/usr/bin/env zx-wrapper
import type { DeploymentComponentKind } from "./deployment-component-kinds.ts";
import {
  REVIEWED_NON_STATIC_COMPONENT_KINDS,
  REVIEWED_PROVIDER_CAPABILITIES,
  REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
  REVIEWED_PROVIDER_IDS,
} from "./provider-capabilities/registry.ts";

export type { DeploymentProviderCapability } from "./provider-capabilities/types.ts";
export {
  REVIEWED_NON_STATIC_COMPONENT_KINDS,
  REVIEWED_PROVIDER_CAPABILITIES,
  REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
  REVIEWED_PROVIDER_IDS,
};

export function providerCapabilityFor(
  provider: string,
): (typeof REVIEWED_PROVIDER_CAPABILITIES)[number] | undefined {
  return REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER[
    provider as keyof typeof REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER
  ] as (typeof REVIEWED_PROVIDER_CAPABILITIES)[number] | undefined;
}

export function providerSupportsComponentKind(provider: string, kind: string): boolean {
  return (
    (!!kind &&
      providerCapabilityFor(provider)?.supportedComponentKinds.includes(
        kind as DeploymentComponentKind,
      )) ||
    false
  );
}

export function providerSupportsMultiComponentKind(provider: string, kind: string): boolean {
  return (
    (!!kind &&
      providerCapabilityFor(provider)?.multiComponentKinds.includes(
        kind as DeploymentComponentKind,
      )) ||
    false
  );
}

export function rolloutPolicyOmissionInPolicy(opts: {
  provider: string;
  componentCount: number;
}): boolean {
  const capability = providerCapabilityFor(opts.provider);
  if (!capability) return false;
  return opts.componentCount > 1
    ? capability.rolloutPolicyOmissionInPolicy.multiComponent
    : capability.rolloutPolicyOmissionInPolicy.singleComponent;
}

export function providerDeclaresReleaseActionType(provider: string, type: string): boolean {
  return providerCapabilityFor(provider)?.releaseActions.declaredTypes.includes(type) || false;
}

export function providerAllowsRoutineProtectedSharedReleaseActionType(
  provider: string,
  type: string,
): boolean {
  return (
    providerCapabilityFor(provider)?.releaseActions.routineAllowedTypes.includes(type) || false
  );
}
