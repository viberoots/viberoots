#!/usr/bin/env zx-wrapper
import type { DeploymentBase } from "./contract-types.ts";
import type { VercelProviderTarget } from "./vercel-provider-target.ts";
import { VERCEL_PROVIDER } from "./vercel-provider-target.ts";

export type VercelDeployment = DeploymentBase & {
  provider: typeof VERCEL_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: VercelProviderTarget;
};
