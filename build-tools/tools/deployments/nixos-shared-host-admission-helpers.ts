#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";
import { resolveSourceRunAdmittedSecretReferences } from "./deployment-secret-admission.ts";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot.ts";
import {
  resolveDeploymentReviewedTargetEnvironment,
  type DeploymentReviewedTargetEnvironmentAdmission,
} from "./deployment-reviewed-target-environment.ts";
import { deploymentGitIsAncestor } from "./deployment-git-ref.ts";

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
  reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot,
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
