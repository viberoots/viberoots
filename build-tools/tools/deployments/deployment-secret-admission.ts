#!/usr/bin/env zx-wrapper
import { resolveDeploymentVaultAdmittedReferences } from "./deployment-secret-vault.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec.ts";

type SourceAdmittedContextLike = {
  secretRequirements?: DeploymentRequirement[];
  admittedSecretReferences?: DeploymentSecretAdmittedReference[];
};

export async function resolveInitialAdmittedSecretReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  return await resolveDeploymentVaultAdmittedReferences(opts);
}

export async function resolveSourceRunAdmittedSecretReferences(opts: {
  sourceAdmittedContext?: SourceAdmittedContextLike;
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  const sourceReferences = Array.isArray(opts.sourceAdmittedContext?.admittedSecretReferences)
    ? opts.sourceAdmittedContext.admittedSecretReferences
    : [];
  if (sourceReferences.length > 0) return sourceReferences;
  return await resolveInitialAdmittedSecretReferences({
    requirements: opts.sourceAdmittedContext?.secretRequirements || opts.requirements,
    targetScope: opts.targetScope,
    secretContext: opts.secretContext,
  });
}
