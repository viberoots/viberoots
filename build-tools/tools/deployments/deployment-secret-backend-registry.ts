#!/usr/bin/env zx-wrapper
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { DeploymentSecretBackend } from "./deployment-secret-runtime";
import { createDeploymentVaultSecretBackend } from "./deployment-secret-vault";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";

type DeploymentSecretBackendFactory = (opts: {
  secretContext?: DeploymentSecretContext;
}) => DeploymentSecretBackend;

const DEPLOYMENT_SECRET_BACKENDS = new Map<
  DeploymentSecretBackendKind,
  DeploymentSecretBackendFactory
>([["vault", ({ secretContext }) => createDeploymentVaultSecretBackend(secretContext)]]);

export function createRegisteredDeploymentSecretBackend(opts: {
  backend: DeploymentSecretBackendKind;
  secretContext?: DeploymentSecretContext;
}): DeploymentSecretBackend {
  const factory = DEPLOYMENT_SECRET_BACKENDS.get(opts.backend);
  if (!factory) {
    throw new Error(`deployment secret backend ${opts.backend} is not registered`);
  }
  return factory({ secretContext: opts.secretContext });
}
