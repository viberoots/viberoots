#!/usr/bin/env zx-wrapper

export const CLOUDFLARE_CONTAINERS_PROVIDER = "cloudflare-containers";

export type CloudflareContainersIngressMode = "public" | "private" | "none";

export type CloudflareContainersProviderTarget = {
  accountId: string;
  worker: string;
  ingressMode: CloudflareContainersIngressMode;
  domain?: string;
  cloudflareZoneId?: string;
  containerPort: number;
  healthPath?: string;
  workersDevException: boolean;
  sleepAfter?: string;
  maxInstances?: string;
  canonicalUrl?: string;
  providerTargetIdentity: string;
};

export function deriveCloudflareContainersProviderTarget(input: {
  accountId: string;
  worker: string;
  ingressMode: string;
  domain?: string;
  cloudflareZoneId?: string;
  containerPort: number;
  healthPath?: string;
  workersDevException?: boolean;
  sleepAfter?: string;
  maxInstances?: string;
}): CloudflareContainersProviderTarget {
  const accountId = input.accountId.trim();
  const worker = input.worker.trim();
  const ingressMode = input.ingressMode.trim() as CloudflareContainersIngressMode;
  const domain = input.domain?.trim();
  const cloudflareZoneId = input.cloudflareZoneId?.trim();
  return {
    accountId,
    worker,
    ingressMode,
    ...(domain ? { domain } : {}),
    ...(cloudflareZoneId ? { cloudflareZoneId } : {}),
    containerPort: input.containerPort,
    ...(input.healthPath ? { healthPath: input.healthPath.trim() } : {}),
    workersDevException: input.workersDevException || false,
    ...(input.sleepAfter ? { sleepAfter: input.sleepAfter.trim() } : {}),
    ...(input.maxInstances ? { maxInstances: input.maxInstances.trim() } : {}),
    ...(domain
      ? { canonicalUrl: `https://${domain}/` }
      : input.workersDevException
        ? { canonicalUrl: `https://${worker}.workers.dev/` }
        : {}),
    providerTargetIdentity: `${CLOUDFLARE_CONTAINERS_PROVIDER}:${accountId}/${worker}`,
  };
}
