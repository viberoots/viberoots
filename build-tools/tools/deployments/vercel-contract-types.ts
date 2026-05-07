#!/usr/bin/env zx-wrapper
import type { DeploymentBase } from "./contract-types";
import type { OpenTofuProvisionerMetadata } from "./opentofu-stack";
import type { VercelProviderTarget } from "./vercel-provider-target";
import { VERCEL_PROVIDER } from "./vercel-provider-target";

export type VercelDeployment = DeploymentBase & {
  provider: typeof VERCEL_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  provisioner?:
    | {
        type: string;
        config: string;
      }
    | OpenTofuProvisionerMetadata;
  providerTarget: VercelProviderTarget;
};
