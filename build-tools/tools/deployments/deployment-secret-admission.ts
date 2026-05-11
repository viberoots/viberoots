#!/usr/bin/env zx-wrapper
import { resolveDeploymentVaultAdmittedReferences } from "./deployment-secret-vault";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { DeploymentRequirement } from "./deployment-requirements";
import type { DeploymentSecretAdmittedReference } from "./deployment-sprinkle-ref";

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
  if (!opts.sourceAdmittedContext) {
    throw new Error("replay requires recorded admitted secret context");
  }
  if (!Array.isArray(opts.sourceAdmittedContext.admittedSecretReferences)) {
    throw new Error("replay requires recorded admitted secret references");
  }
  return opts.sourceAdmittedContext.admittedSecretReferences;
}
