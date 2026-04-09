#!/usr/bin/env zx-wrapper
export const NIXOS_SHARED_HOST_PROVIDER = "nixos-shared-host";
export const CLOUDFLARE_PAGES_PROVIDER = "cloudflare-pages";
export const S3_STATIC_PROVIDER = "s3-static";
export const KUBERNETES_PROVIDER = "kubernetes";

export type NixosSharedHostProviderTarget = {
  host: "nixos-shared-host";
  targetGroup: string;
  appNames: string[];
  deploymentTargetIdentity: string;
  appName?: string;
  hostname?: string;
  containerName?: string;
  sharedDevTargetIdentity?: string;
};

export type CloudflarePagesProviderTarget = {
  account: string;
  project: string;
  id: string;
  canonicalUrl: string;
  providerTargetIdentity: string;
  previewBranch?: string;
  previewSourceRunId?: string;
};

export type S3StaticProviderTarget = {
  account: string;
  bucket: string;
  region: string;
  distribution?: string;
  canonicalUrl: string;
  providerTargetIdentity: string;
};

export type KubernetesProviderTarget = {
  cluster: string;
  namespace: string;
  release: string;
  id: string;
  providerTargetIdentity: string;
};

function normalizeTargetGroup(targetGroup: string): string {
  return targetGroup.trim() || "default";
}

export function deriveNixosSharedHostProviderTarget(input: {
  appName?: string;
  appNames?: string[];
  targetGroup?: string;
}): NixosSharedHostProviderTarget {
  const appNames = Array.from(
    new Set(
      (input.appNames || [input.appName || ""]).map((appName) => appName.trim()).filter(Boolean),
    ),
  ).sort();
  const targetGroup = normalizeTargetGroup(input.targetGroup || "");
  const deploymentTargetIdentity =
    appNames.length === 1
      ? `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:${appNames[0]}`
      : `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:{${appNames.join(",")}}`;
  return {
    host: "nixos-shared-host",
    targetGroup,
    appNames,
    deploymentTargetIdentity,
    ...(appNames.length === 1
      ? {
          appName: appNames[0],
          hostname: `${appNames[0]}.apps.kilty.io`,
          containerName: appNames[0],
          sharedDevTargetIdentity: `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:${appNames[0]}`,
        }
      : {}),
  };
}

export function deriveCloudflarePagesProviderTarget(input: {
  account: string;
  project: string;
  id?: string;
}): CloudflarePagesProviderTarget {
  const account = input.account.trim();
  const project = input.project.trim();
  const id = (input.id || project).trim() || project;
  return {
    account,
    project,
    id,
    canonicalUrl: `https://${project}.pages.dev/`,
    providerTargetIdentity: `${CLOUDFLARE_PAGES_PROVIDER}:${account}/${project}`,
  };
}

export function deriveS3StaticProviderTarget(input: {
  account: string;
  bucket: string;
  region: string;
  distribution?: string;
}): S3StaticProviderTarget {
  const account = input.account.trim();
  const bucket = input.bucket.trim();
  const region = input.region.trim();
  const distribution = String(input.distribution || "").trim();
  return {
    account,
    bucket,
    region,
    ...(distribution ? { distribution } : {}),
    canonicalUrl: distribution
      ? `https://${distribution}/`
      : `https://${bucket}.s3-website.${region}.amazonaws.com/`,
    providerTargetIdentity: distribution
      ? `${S3_STATIC_PROVIDER}:${account}/${bucket}#distribution:${distribution}`
      : `${S3_STATIC_PROVIDER}:${account}/${bucket}`,
  };
}

export function deriveKubernetesProviderTarget(input: {
  cluster: string;
  namespace: string;
  release: string;
  id?: string;
}): KubernetesProviderTarget {
  const cluster = input.cluster.trim();
  const namespace = input.namespace.trim();
  const release = input.release.trim();
  const id = (input.id || `${cluster}/${namespace}/${release}`).trim();
  return {
    cluster,
    namespace,
    release,
    id,
    providerTargetIdentity: `${KUBERNETES_PROVIDER}:${cluster}/${namespace}/${release}`,
  };
}
