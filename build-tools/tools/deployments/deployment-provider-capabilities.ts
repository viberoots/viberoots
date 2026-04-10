#!/usr/bin/env zx-wrapper
import type { DeploymentRolloutMode } from "./deployment-rollout.ts";
import { KUBERNETES_PROVIDER } from "./deployment-provider-targets.ts";
import {
  SERVICE_COMPONENT_KIND,
  SSR_WEBAPP_COMPONENT_KIND,
  STATIC_WEBAPP_COMPONENT_KIND,
  THIRD_PARTY_SERVICE_COMPONENT_KIND,
  type DeploymentComponentKind,
} from "./deployment-component-kinds.ts";

type ReleaseActionsCapability = {
  supportsProtectedShared: boolean;
  declaredTypes: string[];
  routineAllowedTypes: string[];
};

export type DeploymentProviderCapability = {
  provider: string;
  supportedComponentKinds: DeploymentComponentKind[];
  multiComponentKinds: DeploymentComponentKind[];
  supportedRolloutModes: DeploymentRolloutMode[];
  defaultRolloutMode: DeploymentRolloutMode;
  rolloutPolicyOmissionInPolicy: {
    singleComponent: boolean;
    multiComponent: boolean;
  };
  releaseActions: ReleaseActionsCapability;
};

const PROVIDER_CAPABILITIES: Record<string, DeploymentProviderCapability> = {
  "app-store-connect": {
    provider: "app-store-connect",
    supportedComponentKinds: ["mobile-app"],
    multiComponentKinds: [],
    supportedRolloutModes: ["all_at_once", "store_staged"],
    defaultRolloutMode: "all_at_once",
    rolloutPolicyOmissionInPolicy: {
      singleComponent: true,
      multiComponent: false,
    },
    releaseActions: {
      supportsProtectedShared: false,
      declaredTypes: [],
      routineAllowedTypes: [],
    },
  },
  "nixos-shared-host": {
    provider: "nixos-shared-host",
    supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND, SSR_WEBAPP_COMPONENT_KIND],
    multiComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
    supportedRolloutModes: ["all_at_once", "ordered_best_effort"],
    defaultRolloutMode: "all_at_once",
    rolloutPolicyOmissionInPolicy: {
      singleComponent: true,
      multiComponent: false,
    },
    releaseActions: {
      supportsProtectedShared: true,
      declaredTypes: ["cache_warmup", "post_publish_verification", "schema_migration"],
      routineAllowedTypes: ["cache_warmup", "post_publish_verification"],
    },
  },
  "cloudflare-pages": {
    provider: "cloudflare-pages",
    supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
    multiComponentKinds: [],
    supportedRolloutModes: ["all_at_once"],
    defaultRolloutMode: "all_at_once",
    rolloutPolicyOmissionInPolicy: {
      singleComponent: true,
      multiComponent: false,
    },
    releaseActions: {
      supportsProtectedShared: false,
      declaredTypes: [],
      routineAllowedTypes: [],
    },
  },
  "s3-static": {
    provider: "s3-static",
    supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
    multiComponentKinds: [],
    supportedRolloutModes: ["all_at_once"],
    defaultRolloutMode: "all_at_once",
    rolloutPolicyOmissionInPolicy: {
      singleComponent: true,
      multiComponent: false,
    },
    releaseActions: {
      supportsProtectedShared: false,
      declaredTypes: [],
      routineAllowedTypes: [],
    },
  },
  [KUBERNETES_PROVIDER]: {
    provider: KUBERNETES_PROVIDER,
    supportedComponentKinds: [SERVICE_COMPONENT_KIND, THIRD_PARTY_SERVICE_COMPONENT_KIND],
    multiComponentKinds: [SERVICE_COMPONENT_KIND, THIRD_PARTY_SERVICE_COMPONENT_KIND],
    supportedRolloutModes: ["all_at_once", "ordered_best_effort"],
    defaultRolloutMode: "all_at_once",
    rolloutPolicyOmissionInPolicy: {
      singleComponent: true,
      multiComponent: false,
    },
    releaseActions: {
      supportsProtectedShared: false,
      declaredTypes: [],
      routineAllowedTypes: [],
    },
  },
};

export const REVIEWED_NON_STATIC_COMPONENT_KINDS: DeploymentComponentKind[] = [
  SSR_WEBAPP_COMPONENT_KIND,
  "mobile-app",
  SERVICE_COMPONENT_KIND,
  THIRD_PARTY_SERVICE_COMPONENT_KIND,
];

export function providerCapabilityFor(provider: string): DeploymentProviderCapability | undefined {
  return PROVIDER_CAPABILITIES[provider];
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
