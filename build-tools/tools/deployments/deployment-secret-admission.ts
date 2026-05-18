#!/usr/bin/env zx-wrapper
import { resolveDeploymentInfisicalAdmittedReferences } from "./deployment-secret-infisical";
import type {
  DeploymentInfisicalRuntimeConfig,
  DeploymentInfisicalSecretMapping,
} from "./deployment-secret-metadata";
import type { DeploymentVaultRuntimeConfig } from "./deployment-vault-runtime-types";
import { resolveDeploymentVaultAdmittedReferences } from "./deployment-secret-vault";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { DeploymentRequirement } from "./deployment-requirements";
import {
  isDeploymentSecretAdmittedReference,
  type DeploymentSecretAdmittedReference,
  type DeploymentSecretBackendKind,
} from "./deployment-sprinkle-ref";

type SourceAdmittedContextLike = {
  secretRequirements?: DeploymentRequirement[];
  admittedSecretReferences?: DeploymentSecretAdmittedReference[];
};

export async function resolveInitialAdmittedSecretReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretBackend?: DeploymentSecretBackendKind;
  secretBackendProfile?: string;
  vaultRuntime?: DeploymentVaultRuntimeConfig;
  infisicalRuntime?: DeploymentInfisicalRuntimeConfig;
  infisicalSecretMappings?: Record<string, DeploymentInfisicalSecretMapping>;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  const backend = opts.secretBackend || "vault";
  if (backend === "vault") return await resolveDeploymentVaultAdmittedReferences(opts);
  if (backend === "infisical") {
    return await resolveDeploymentInfisicalAdmittedReferences({
      requirements: opts.requirements,
      targetScope: opts.targetScope,
      runtime: opts.infisicalRuntime,
      mappings: opts.infisicalSecretMappings,
      secretContext: opts.secretContext,
      secretBackendProfile: opts.secretBackendProfile,
    });
  }
  throw new Error(`unsupported deployment secret backend ${backend}`);
}

export async function resolveSourceRunAdmittedSecretReferences(opts: {
  sourceAdmittedContext?: SourceAdmittedContextLike;
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  if (!opts.sourceAdmittedContext) {
    throw new Error("replay requires recorded admitted secret context");
  }
  if (!Array.isArray(opts.sourceAdmittedContext.admittedSecretReferences)) {
    throw new Error("replay requires recorded admitted secret references");
  }
  const admitted = opts.sourceAdmittedContext.admittedSecretReferences;
  const invalid = admitted.find((reference) => !isDeploymentSecretAdmittedReference(reference));
  if (invalid) throw new Error("replay requires exact recorded admitted backend references");
  return admitted;
}
