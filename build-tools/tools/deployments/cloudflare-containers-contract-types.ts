#!/usr/bin/env zx-wrapper
import type { DeploymentBase } from "./contract-types";
import {
  CLOUDFLARE_CONTAINERS_PROVIDER,
  type CloudflareContainersProviderTarget,
} from "./cloudflare-containers-provider-target";

export type CloudflareContainersDeployment = DeploymentBase & {
  provider: typeof CLOUDFLARE_CONTAINERS_PROVIDER;
  publisher: { type: string; config: string };
  providerTarget: CloudflareContainersProviderTarget;
};
