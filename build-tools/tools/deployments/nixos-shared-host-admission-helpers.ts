#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import { resolveSourceRunAdmittedSecretReferences } from "./deployment-secret-admission";
import type { DeploymentSecretAdmittedReference } from "./deployment-sprinkle-ref";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { DeploymentReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";
import {
  resolveDeploymentReviewedTargetEnvironment,
  type DeploymentReviewedTargetEnvironmentAdmission,
} from "./deployment-reviewed-target-environment";
import { deploymentGitIsAncestor } from "./deployment-git-ref";

export type NixosSharedHostTargetEnvironmentAdmission =
  DeploymentReviewedTargetEnvironmentAdmission;

export async function gitIsAncestor(
  workspaceRoot: string,
  ancestorRevision: string,
  descendantRevision: string,
): Promise<boolean> {
  return await deploymentGitIsAncestor({
    workspaceRoot,
    ancestorRevision,
    descendantRevision,
    purpose: "nixos-shared-host source revision",
  });
}

export async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot,
): Promise<NixosSharedHostTargetEnvironmentAdmission> {
  const providerTargetIdentity = nixosSharedHostDeploymentTargetIdentity(deployment);
  return await resolveDeploymentReviewedTargetEnvironment({
    workspaceRoot,
    deployment,
    providerTargetIdentity,
    lockScope: providerTargetIdentity,
    ...(reviewedSourceSnapshot ? { reviewedSourceSnapshot } : {}),
  });
}

export function replayMismatch(field: string, current: string, source: string): string {
  return `${field} mismatch: current=${current} source=${source}`;
}

export async function resolveNixosSharedHostAdmittedSecretReferences(opts: {
  deployment: NixosSharedHostDeployment;
  admittedContext: NixosSharedHostAdmittedContext;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  return await resolveSourceRunAdmittedSecretReferences({
    sourceAdmittedContext: opts.admittedContext,
    requirements: opts.deployment.secretRequirements,
    targetScope: opts.admittedContext.targetEnvironment.lockScope,
    secretContext: opts.secretContext,
  });
}
