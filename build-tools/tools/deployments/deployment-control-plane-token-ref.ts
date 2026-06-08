#!/usr/bin/env zx-wrapper
import { createRegisteredDeploymentSecretBackend } from "./deployment-secret-backend-registry";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";
import { resolveRuntimeTokenBinding } from "./deployment-runtime-token-binding";

export async function resolveControlPlaneTokenRef(opts: {
  tokenRef: string;
  backend?: DeploymentSecretBackendKind;
  backendProfile?: string;
  workspaceRoot?: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  if (opts.tokenRef.startsWith("secret://")) {
    return resolveSecretToken({
      tokenRef: opts.tokenRef,
      backend: opts.backend || "vault",
      backendProfile: opts.backendProfile,
    });
  }
  if (opts.tokenRef.startsWith("runtime://")) {
    return resolveRuntimeTokenBinding({
      tokenRef: opts.tokenRef,
      workspaceRoot: opts.workspaceRoot,
      env: opts.env,
    });
  }
  throw new Error("controlPlaneTokenRef must be a secret:// or runtime:// ref");
}

async function resolveSecretToken(opts: {
  tokenRef: string;
  backend: DeploymentSecretBackendKind;
  backendProfile?: string;
}) {
  const backend = createRegisteredDeploymentSecretBackend({ backend: opts.backend });
  const material = await backend.acquire({
    name: "control_plane_service_token",
    step: "publish",
    contractId: opts.tokenRef,
    required: true,
    backend: opts.backend,
    backendProfile: opts.backendProfile,
    referenceId: `${opts.backend}:${opts.tokenRef}`,
  });
  return material.value;
}
