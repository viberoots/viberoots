#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy.ts";
import type { DeploymentComponentKind } from "./deployment-component-kinds.ts";
import type { DeploymentRolloutPolicy } from "./deployment-rollout.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";
import type { DeploymentSmokePolicy } from "./deployment-smoke-policy.ts";
import type { DeploymentTargetException } from "./deployment-target-exceptions.ts";
import type { DeploymentVaultRuntimeConfig } from "./deployment-vault-runtime-types.ts";
import {
  MOBILE_APP_COMPONENT_KIND,
  SSR_WEBAPP_COMPONENT_KIND,
  STATIC_WEBAPP_COMPONENT_KIND,
} from "./deployment-component-kinds.ts";
import {
  APP_STORE_CONNECT_PROVIDER,
  CLOUDFLARE_PAGES_PROVIDER,
  GOOGLE_PLAY_PROVIDER,
  KUBERNETES_PROVIDER,
  NIXOS_SHARED_HOST_PROVIDER,
  S3_STATIC_PROVIDER,
  type AppStoreConnectProviderTarget,
  type CloudflarePagesProviderTarget,
  type GooglePlayProviderTarget,
  type KubernetesProviderTarget,
  type NixosSharedHostProviderTarget,
  type S3StaticProviderTarget,
} from "./deployment-provider-targets.ts";
import type { VercelDeployment } from "./vercel-contract-types.ts";

export const STATIC_WEBAPP_COMPONENT = "static-webapp";
export const SSR_WEBAPP_COMPONENT = "ssr-webapp";
export { MOBILE_APP_COMPONENT_KIND };
export const MOBILE_APP_COMPONENT = MOBILE_APP_COMPONENT_KIND;
export {
  APP_STORE_CONNECT_PROVIDER,
  CLOUDFLARE_PAGES_PROVIDER,
  GOOGLE_PLAY_PROVIDER,
  KUBERNETES_PROVIDER,
  NIXOS_SHARED_HOST_PROVIDER,
  S3_STATIC_PROVIDER,
  deriveAppStoreConnectProviderTarget,
  deriveCloudflarePagesProviderTarget,
  deriveGooglePlayProviderTarget,
  deriveKubernetesProviderTarget,
  deriveNixosSharedHostProviderTarget,
  deriveS3StaticProviderTarget,
  type AppStoreConnectProviderTarget,
  type CloudflarePagesProviderTarget,
  type GooglePlayProviderTarget,
  type KubernetesProviderTarget,
  type NixosSharedHostProviderTarget,
  type S3StaticProviderTarget,
} from "./deployment-provider-targets.ts";
export {
  VERCEL_PROVIDER,
  deriveVercelProviderTarget,
  type VercelProviderTarget,
} from "./vercel-provider-target.ts";

export type DeploymentPrerequisiteMode = "ordering_only" | "health_gated";

export type DeploymentPrerequisite = {
  deploymentId: string;
  mode: DeploymentPrerequisiteMode;
};

export type DeploymentPreviewIdentitySelector = "branch" | "commit" | "source_run";

export type DeploymentPreviewPolicy = {
  targetDerivation: string;
  isolationClass: string;
  identitySelector: DeploymentPreviewIdentitySelector;
  cleanupTtl: string;
  smokeTarget: "normal_url" | "preview_url";
  lockScope: "shared" | "preview";
};

export type DeploymentBootstrapMode = "first_install" | "offline_recovery";

export type DeploymentBootstrapPolicy = {
  scope: "deployment_authority";
  modes: DeploymentBootstrapMode[];
};

export type DeploymentComponent = {
  id: string;
  kind: DeploymentComponentKind;
  target: string;
};

export type DeploymentBase = {
  deploymentId: string;
  label: string;
  name: string;
  protectionClass: string;
  lanePolicyRef: string;
  lanePolicy: DeploymentLanePolicy;
  environmentStage: string;
  admissionPolicyRef: string;
  admissionPolicy: DeploymentAdmissionPolicy;
  prerequisites: DeploymentPrerequisite[];
  secretRequirements: DeploymentRequirement[];
  runtimeConfigRequirements: DeploymentRequirement[];
  releaseActions: DeploymentReleaseAction[];
  targetExceptions: DeploymentTargetException[];
  smoke?: DeploymentSmokePolicy;
  rolloutPolicy?: DeploymentRolloutPolicy;
  bootstrap?: DeploymentBootstrapPolicy;
  vaultRuntime?: DeploymentVaultRuntimeConfig;
  component: {
    kind: DeploymentComponentKind;
    target: string;
  };
  components: DeploymentComponent[];
  preview?: DeploymentPreviewPolicy;
};

export type NixosSharedHostDeploymentComponent = DeploymentComponent & {
  kind: typeof STATIC_WEBAPP_COMPONENT_KIND | typeof SSR_WEBAPP_COMPONENT_KIND;
  runtime: {
    appName: string;
    containerPort: number;
    healthPath?: string;
    targetGroup?: string;
  } & (
    | {}
    | {
        runtimeContract: NixosSharedHostSsrRuntimeContract;
      }
  );
  providerTarget: NixosSharedHostProviderTarget;
};

export type NixosSharedHostSsrFramework = "express" | "next" | "vite" | "hatch";
export type NixosSharedHostSsrServingTopology = "single-host-node-with-nginx";

export type NixosSharedHostSsrRuntimeContract = {
  type: "node-dist-server-v1";
  framework: NixosSharedHostSsrFramework;
  serverEntry: "dist/server/index.js";
  clientDir: "dist/client";
  servingTopology: NixosSharedHostSsrServingTopology;
  environmentNeutralBuild: true;
  runtimeConfigInjection: "runtime_config_requirements";
  secretInjection: "secret_requirements";
};

export type NixosSharedHostDeployment = DeploymentBase & {
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
  publisher: { type: string };
  provisioner?: { type: string };
  runtime?: NixosSharedHostDeploymentComponent["runtime"];
  components: NixosSharedHostDeploymentComponent[];
  providerTarget: NixosSharedHostProviderTarget;
};

export type CloudflarePagesDeployment = DeploymentBase & {
  provider: typeof CLOUDFLARE_PAGES_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: CloudflarePagesProviderTarget;
};

export type S3StaticDeployment = DeploymentBase & {
  provider: typeof S3_STATIC_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  provisioner?: { type: string };
  providerTarget: S3StaticProviderTarget;
};

export type KubernetesDeployment = DeploymentBase & {
  provider: typeof KUBERNETES_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  provisioner?: {
    type: string;
    config: string;
  };
  providerTarget: KubernetesProviderTarget;
};

export type AppStoreConnectDeployment = DeploymentBase & {
  provider: typeof APP_STORE_CONNECT_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: AppStoreConnectProviderTarget;
};

export type GooglePlayDeployment = DeploymentBase & {
  provider: typeof GOOGLE_PLAY_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: GooglePlayProviderTarget;
};

export type DeploymentTarget =
  | NixosSharedHostDeployment
  | CloudflarePagesDeployment
  | S3StaticDeployment
  | KubernetesDeployment
  | AppStoreConnectDeployment
  | GooglePlayDeployment
  | VercelDeployment;

export type { VercelDeployment } from "./vercel-contract-types.ts";
export * from "./deployment-contract-helpers.ts";

export function hasNixosSharedHostSsrRuntimeContract(
  component: NixosSharedHostDeploymentComponent,
): component is NixosSharedHostDeploymentComponent & {
  kind: typeof SSR_WEBAPP_COMPONENT;
  runtime: NixosSharedHostDeploymentComponent["runtime"] & {
    runtimeContract: NixosSharedHostSsrRuntimeContract;
  };
} {
  return component.kind === SSR_WEBAPP_COMPONENT && "runtimeContract" in component.runtime;
}
