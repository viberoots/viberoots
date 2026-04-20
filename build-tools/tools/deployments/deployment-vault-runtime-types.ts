#!/usr/bin/env zx-wrapper

export type DeploymentVaultRuntimeConfig = {
  addr?: string;
  oidcIssuer?: string;
  audience?: string;
  deploymentClientId?: string;
  deploymentEnvironment?: string;
  roleName?: string;
  jwtFile?: string;
  clientSecretEnv?: string;
};
