#!/usr/bin/env zx-wrapper
import type { DeploymentCredentialSource } from "./deployment-credential-source-selection";
import type { DeploymentPkceCallbackProfileInput } from "./deployment-pkce-callback-profile";

export type DeploymentVaultRuntimeConfig = {
  addr?: string;
  oidcIssuer?: string;
  audience?: string;
  deploymentClientId?: string;
  cliPublicClientId?: string;
  serviceAccountClientId?: string;
  deploymentEnvironment?: string;
  roleName?: string;
  jwtFile?: string;
  clientSecretEnv?: string;
  preferredCredentialSource?: DeploymentCredentialSource;
  jenkinsClientSecretEnv?: string;
  externalOidcTokenEnv?: string;
  pkceCallback?: DeploymentPkceCallbackProfileInput;
};
