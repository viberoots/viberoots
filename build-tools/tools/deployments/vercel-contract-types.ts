#!/usr/bin/env zx-wrapper
import type { DeploymentBase } from "./contract-types";
import type { VercelProviderTarget } from "./vercel-provider-target";
import { VERCEL_PROVIDER } from "./vercel-provider-target";

export type VercelDeployment = DeploymentBase & {
  provider: typeof VERCEL_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: VercelProviderTarget;
};
