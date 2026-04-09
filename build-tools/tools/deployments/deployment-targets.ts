#!/usr/bin/env zx-wrapper
import type {
  CloudflarePagesDeployment,
  DeploymentTarget,
  KubernetesDeployment,
  NixosSharedHostDeployment,
  S3StaticDeployment,
} from "./contract-types.ts";
import {
  CLOUDFLARE_PAGES_PROVIDER,
  KUBERNETES_PROVIDER,
  NIXOS_SHARED_HOST_PROVIDER,
  S3_STATIC_PROVIDER,
} from "./contract-types.ts";

export function isNixosSharedHostDeployment(
  deployment: DeploymentTarget,
): deployment is NixosSharedHostDeployment {
  return deployment.provider === NIXOS_SHARED_HOST_PROVIDER;
}

export function isCloudflarePagesDeployment(
  deployment: DeploymentTarget,
): deployment is CloudflarePagesDeployment {
  return deployment.provider === CLOUDFLARE_PAGES_PROVIDER;
}

export function isS3StaticDeployment(
  deployment: DeploymentTarget,
): deployment is S3StaticDeployment {
  return deployment.provider === S3_STATIC_PROVIDER;
}

export function isKubernetesDeployment(
  deployment: DeploymentTarget,
): deployment is KubernetesDeployment {
  return deployment.provider === KUBERNETES_PROVIDER;
}

export function isMultiComponentDeployment(deployment: DeploymentTarget): boolean {
  return deployment.components.length > 1;
}

export function componentTargetsFor(deployment: DeploymentTarget): string[] {
  return deployment.components.map((component) => component.target);
}

export function providerTargetIdentityFor(deployment: DeploymentTarget): string {
  return isNixosSharedHostDeployment(deployment)
    ? deployment.providerTarget.deploymentTargetIdentity
    : deployment.providerTarget.providerTargetIdentity;
}
