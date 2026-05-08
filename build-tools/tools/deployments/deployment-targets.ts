#!/usr/bin/env zx-wrapper
import type {
  AppStoreConnectDeployment,
  CloudflareContainersDeployment,
  CloudflarePagesDeployment,
  DeploymentTarget,
  GooglePlayDeployment,
  KubernetesDeployment,
  NixosSharedHostDeployment,
  OpenTofuDeployment,
  S3StaticDeployment,
  VercelDeployment,
} from "./contract-types";
import {
  APP_STORE_CONNECT_PROVIDER,
  CLOUDFLARE_PAGES_PROVIDER,
  GOOGLE_PLAY_PROVIDER,
  KUBERNETES_PROVIDER,
  NIXOS_SHARED_HOST_PROVIDER,
  OPENTOFU_PROVIDER,
  S3_STATIC_PROVIDER,
  VERCEL_PROVIDER,
} from "./contract-types";
import { CLOUDFLARE_CONTAINERS_PROVIDER } from "./cloudflare-containers-provider-target";

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

export function isCloudflareContainersDeployment(
  deployment: DeploymentTarget,
): deployment is CloudflareContainersDeployment {
  return deployment.provider === CLOUDFLARE_CONTAINERS_PROVIDER;
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

export function isOpenTofuDeployment(
  deployment: DeploymentTarget,
): deployment is OpenTofuDeployment {
  return deployment.provider === OPENTOFU_PROVIDER;
}

export function isAppStoreConnectDeployment(
  deployment: DeploymentTarget,
): deployment is AppStoreConnectDeployment {
  return deployment.provider === APP_STORE_CONNECT_PROVIDER;
}

export function isGooglePlayDeployment(
  deployment: DeploymentTarget,
): deployment is GooglePlayDeployment {
  return deployment.provider === GOOGLE_PLAY_PROVIDER;
}

export function isVercelDeployment(deployment: DeploymentTarget): deployment is VercelDeployment {
  return deployment.provider === VERCEL_PROVIDER;
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
