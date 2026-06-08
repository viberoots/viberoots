#!/usr/bin/env zx-wrapper
import { createRegisteredDeploymentSecretBackend } from "./deployment-secret-backend-registry";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import { deploymentSecretContext } from "./deployment-secret-context";
import type {
  DeploymentInfisicalRuntimeConfig,
  DeploymentInfisicalSecretMapping,
} from "./deployment-secret-metadata";
import type { DeploymentRequirement } from "./deployment-requirements";
import { resolveInitialAdmittedSecretReferences } from "./deployment-secret-admission";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";
import type { DeploymentVaultRuntimeConfig } from "./deployment-vault-runtime-types";
import { resolveRuntimeTokenBinding } from "./deployment-runtime-token-binding";

export async function resolveControlPlaneTokenRef(opts: {
  tokenRef: string;
  backend?: DeploymentSecretBackendKind;
  backendProfile?: string;
  contextName?: string;
  targetScope?: string;
  vaultRuntime?: DeploymentVaultRuntimeConfig;
  infisicalRuntime?: DeploymentInfisicalRuntimeConfig;
  infisicalSecretMappings?: Record<string, DeploymentInfisicalSecretMapping>;
  secretContext?: DeploymentSecretContext;
  workspaceRoot?: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  if (opts.tokenRef.startsWith("secret://")) {
    return resolveSecretToken({
      tokenRef: opts.tokenRef,
      backend: opts.backend || "vault",
      backendProfile: opts.backendProfile,
      contextName: opts.contextName,
      targetScope: opts.targetScope,
      vaultRuntime: opts.vaultRuntime,
      infisicalRuntime: opts.infisicalRuntime,
      infisicalSecretMappings: opts.infisicalSecretMappings,
      secretContext: opts.secretContext,
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
  contextName?: string;
  targetScope?: string;
  vaultRuntime?: DeploymentVaultRuntimeConfig;
  infisicalRuntime?: DeploymentInfisicalRuntimeConfig;
  infisicalSecretMappings?: Record<string, DeploymentInfisicalSecretMapping>;
  secretContext?: DeploymentSecretContext;
}) {
  const secretContext = deploymentSecretContext(opts.secretContext);
  const requirement = controlPlaneServiceTokenRequirement(opts.tokenRef);
  try {
    const [admitted] = await resolveInitialAdmittedSecretReferences({
      requirements: [requirement],
      targetScope: opts.targetScope || targetScopeFor(opts.contextName),
      secretBackend: opts.backend,
      secretBackendProfile: opts.backendProfile,
      vaultRuntime: opts.vaultRuntime,
      infisicalRuntime: opts.infisicalRuntime,
      infisicalSecretMappings: opts.infisicalSecretMappings,
      secretContext,
    });
    if (!admitted) throw new Error(`required secret contract ${opts.tokenRef} is missing`);
    const backend = createRegisteredDeploymentSecretBackend({
      backend: opts.backend,
      secretContext,
    });
    const material = await backend.acquire(admitted);
    return material.value;
  } catch (error) {
    throw new Error(
      `control-plane service token ref ${opts.tokenRef} could not be resolved through selected ${opts.backend} secret backend${contextSuffix(opts.contextName)}: ${redactedErrorMessage(error)}`,
    );
  }
}

function controlPlaneServiceTokenRequirement(tokenRef: string): DeploymentRequirement {
  return {
    name: "control_plane_service_token",
    step: "publish",
    contractId: tokenRef,
    required: true,
  };
}

function targetScopeFor(contextName: string | undefined) {
  return `control-plane:${String(contextName || "selected").trim() || "selected"}`;
}

function contextSuffix(contextName: string | undefined) {
  const normalized = String(contextName || "").trim();
  return normalized ? ` for ${normalized}` : "";
}

function redactedErrorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/"clientSecret"\s*:\s*"[^"]*"/gi, '"clientSecret":"<redacted>"')
    .replace(/clientSecret\s*[:=]\s*\S+/gi, "clientSecret=(redacted)")
    .replace(
      /\b(token|secret|password|client[_-]?secret)\b\s*[:=](?!\/\/)\s*\S+/gi,
      "$1=(redacted)",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer (redacted)");
}
