#!/usr/bin/env zx-wrapper
import { resolveDeploymentVaultAdmittedReferences } from "./deployment-secret-vault";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { DeploymentRequirement } from "./deployment-requirements";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec";

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
