#!/usr/bin/env zx-wrapper
import type { VaultCredentialConfig } from "./deployment-secret-vault-credentials";
import type { InfisicalCredentialConfig } from "./deployment-secret-infisical-credentials";

export type DeploymentSecretContext =
  | { kind: "fixture" }
  | { kind: "vault"; credential: VaultCredentialConfig }
  | { kind: "infisical"; credential: InfisicalCredentialConfig };

let activeDeploymentSecretContext: DeploymentSecretContext | undefined;

export function activateDeploymentSecretContext(context: DeploymentSecretContext | undefined) {
  const previous = activeDeploymentSecretContext;
  activeDeploymentSecretContext = context;
  return () => {
    activeDeploymentSecretContext = previous;
  };
}

export function deploymentSecretContext(
  context?: DeploymentSecretContext,
): DeploymentSecretContext | undefined {
  return context || activeDeploymentSecretContext;
}

export function missingDeploymentSecretContextError(): Error {
  return new Error(
    "secret-consuming deployments require an explicit deployment secret context from vault_runtime or infisical_runtime metadata plus a reviewed credential source, or VBR_DEPLOYMENT_SECRET_FIXTURE_PATH for local/test fixtures",
  );
}
