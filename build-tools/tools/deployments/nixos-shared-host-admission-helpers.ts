#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";
import { resolveSourceRunAdmittedSecretReferences } from "./deployment-secret-admission.ts";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot.ts";

export type NixosSharedHostTargetEnvironmentAdmission = {
  mode: "stage_branch_snapshot";
  targetRef: string;
  targetRevision: string;
  providerTargetIdentity: string;
  lockScope: string;
  reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot;
};

function requiredPolicyRef(deployment: NixosSharedHostDeployment): string {
  const sourceRef = requiredDeploymentStageBranch(deployment);
  if (!deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  return sourceRef;
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  return String((out as any).stdout || "").trim();
}

export async function gitIsAncestor(
  workspaceRoot: string,
  ancestorRevision: string,
  descendantRevision: string,
): Promise<boolean> {
  const out = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
  })`git merge-base --is-ancestor ${ancestorRevision} ${descendantRevision}`.nothrow();
  return (out as any).exitCode === 0;
}

export async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
  reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot,
): Promise<NixosSharedHostTargetEnvironmentAdmission> {
  const targetRef = requiredPolicyRef(deployment);
  const targetRevision =
    reviewedSourceSnapshot?.sourceRevision ||
    (await gitStdout(workspaceRoot, ["rev-parse", targetRef]));
  const providerTargetIdentity = nixosSharedHostDeploymentTargetIdentity(deployment);
  return {
    mode: "stage_branch_snapshot",
    targetRef,
    targetRevision,
    providerTargetIdentity,
    lockScope: providerTargetIdentity,
    ...(reviewedSourceSnapshot ? { reviewedSourceSnapshot } : {}),
  };
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
