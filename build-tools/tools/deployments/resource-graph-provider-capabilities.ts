#!/usr/bin/env zx-wrapper
import {
  providerCapabilityFor,
  type DeploymentProviderCapability,
} from "./deployment-provider-capabilities";

export function reviewedProviderCapability(
  provider: string,
): DeploymentProviderCapability | undefined {
  return providerCapabilityFor(provider);
}

export function providerCapabilityBindingFacts(
  capability: DeploymentProviderCapability,
): Record<string, unknown> {
  return {
    providerCapabilityId: `provider-capability:${capability.provider}`,
    providerCapabilityVersion: "provider-capability@1",
    providerCapabilitySource: capabilitySourcePath(capability.provider),
    authorityBoundary: "reviewed-provider-capability-registry",
    supportedComponentKinds: capability.supportedComponentKinds,
    multiComponentKinds: capability.multiComponentKinds,
    supportedRolloutModes: capability.supportedRolloutModes,
    defaultRolloutMode: capability.defaultRolloutMode,
    canonicalTargetIdentityFields: capability.canonicalTargetIdentity.fields,
    canonicalTargetIdentityLockKeyShape: capability.canonicalTargetIdentity.lockKeyShape.map(
      (bullet) => bullet.text,
    ),
    publisherTypes: capability.builtInPublisherContract.publisherTypes,
    releaseActionTypes: capability.releaseActions.declaredTypes,
    protectedSharedReleaseActions: capability.releaseActions.routineAllowedTypes,
    referenceRules: {
      source: "reviewed_provider_capability",
      identityFact: "providerTarget.identity",
      registryKey: capability.provider,
    },
  };
}

function capabilitySourcePath(provider: string): string {
  return `build-tools/tools/deployments/provider-capabilities/${provider}.ts`;
}
