#!/usr/bin/env zx-wrapper
export const NIXOS_SHARED_HOST_PROVIDER = "nixos-shared-host";
export const CLOUDFLARE_PAGES_PROVIDER = "cloudflare-pages";
export const S3_STATIC_PROVIDER = "s3-static";
export const KUBERNETES_PROVIDER = "kubernetes";
export const OPENTOFU_PROVIDER = "opentofu";
export const APP_STORE_CONNECT_PROVIDER = "app-store-connect";
export const GOOGLE_PLAY_PROVIDER = "google-play";

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
  accountId?: string;
  project: string;
  id: string;
  customDomain?: string;
  customDomainZoneId?: string;
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
  serviceKind?: string;
  ingressMode?: string;
  healthPath?: string;
};

export type AppStoreConnectProviderTarget = {
  issuer: string;
  app: string;
  bundleId: string;
  platform: "ios";
  track: "testflight-internal" | "testflight-external" | "app-store";
  signingModel: "app-store";
  providerTargetIdentity: string;
};

export type GooglePlayProviderTarget = {
  developerAccount: string;
  app: string;
  packageName: string;
  platform: "android";
  track: "internal" | "alpha" | "beta" | "production";
  signingModel: "play-app-signing";
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
  accountId?: string;
  project: string;
  id?: string;
  customDomain?: string;
  customDomainZoneId?: string;
}): CloudflarePagesProviderTarget {
  const account = input.account.trim();
  const accountId = input.accountId?.trim();
  const project = input.project.trim();
  const id = (input.id || project).trim() || project;
  const customDomain = input.customDomain?.trim();
  const customDomainZoneId = input.customDomainZoneId?.trim();
  return {
    account,
    ...(accountId ? { accountId } : {}),
    project,
    id,
    ...(customDomain ? { customDomain } : {}),
    ...(customDomainZoneId ? { customDomainZoneId } : {}),
    canonicalUrl: customDomain ? `https://${customDomain}/` : `https://${project}.pages.dev/`,
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
  serviceKind?: string;
  ingressMode?: string;
  healthPath?: string;
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
    ...(input.serviceKind ? { serviceKind: input.serviceKind.trim() } : {}),
    ...(input.ingressMode ? { ingressMode: input.ingressMode.trim() } : {}),
    ...(input.healthPath ? { healthPath: input.healthPath.trim() } : {}),
  };
}

export function deriveAppStoreConnectProviderTarget(input: {
  issuer: string;
  app: string;
  bundleId: string;
  platform?: string;
  track: string;
  signingModel: string;
}): AppStoreConnectProviderTarget {
  const issuer = input.issuer.trim();
  const app = input.app.trim();
  const bundleId = input.bundleId.trim();
  const platform = "ios";
  const track = (input.track.trim() ||
    "testflight-internal") as AppStoreConnectProviderTarget["track"];
  const signingModel = (input.signingModel.trim() ||
    "app-store") as AppStoreConnectProviderTarget["signingModel"];
  return {
    issuer,
    app,
    bundleId,
    platform,
    track,
    signingModel,
    providerTargetIdentity: `${APP_STORE_CONNECT_PROVIDER}:${issuer}/${app}#track:${track}`,
  };
}

export function deriveGooglePlayProviderTarget(input: {
  developerAccount: string;
  app: string;
  packageName: string;
  platform?: string;
  track: string;
  signingModel: string;
}): GooglePlayProviderTarget {
  const developerAccount = input.developerAccount.trim();
  const app = input.app.trim();
  const packageName = input.packageName.trim();
  const platform = "android";
  const track = (input.track.trim() || "internal") as GooglePlayProviderTarget["track"];
  const signingModel = (input.signingModel.trim() ||
    "play-app-signing") as GooglePlayProviderTarget["signingModel"];
  return {
    developerAccount,
    app,
    packageName,
    platform,
    track,
    signingModel,
    providerTargetIdentity: `${GOOGLE_PLAY_PROVIDER}:${developerAccount}/${app}#track:${track}`,
  };
}
