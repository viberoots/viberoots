#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";

export type NixosSharedHostSourceAdmission = {
  mode: "stage_branch_head" | "source_run_reuse" | "promotion_source_run";
  sourceRef: string;
  sourceRevision: string;
  artifactIdentity: string;
  artifactTrustMode: "recorded_exact_artifact";
  sourceRunId?: string;
  sourceDeploymentId?: string;
};

export type NixosSharedHostTargetEnvironmentAdmission = {
  mode: "stage_branch_snapshot";
  targetRef: string;
  targetRevision: string;
  providerTargetIdentity: string;
  lockScope: string;
};

export type NixosSharedHostAdmittedContext = {
  lanePolicyRef: string;
  lanePolicyFingerprint: string;
  admissionPolicyRef: string;
  admissionPolicyFingerprint: string;
  environmentStage: string;
  source: NixosSharedHostSourceAdmission;
  targetEnvironment: NixosSharedHostTargetEnvironmentAdmission;
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

function baseContext(deployment: NixosSharedHostDeployment) {
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
  };
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

async function gitIsAncestor(
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

async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
): Promise<NixosSharedHostTargetEnvironmentAdmission> {
  const targetRef = requiredPolicyRef(deployment);
  const targetRevision = await gitStdout(workspaceRoot, ["rev-parse", targetRef]);
  return {
    mode: "stage_branch_snapshot",
    targetRef,
    targetRevision,
    providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
    lockScope: deployment.providerTarget.sharedDevTargetIdentity,
  };
}

function replayMismatch(field: string, current: string, source: string): string {
  return `${field} mismatch: current=${current} source=${source}`;
}

export async function resolveInitialNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity: string;
}): Promise<NixosSharedHostAdmittedContext> {
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
  return {
    ...baseContext(opts.deployment),
    source: {
      mode: "stage_branch_head",
      sourceRef: target.targetRef,
      sourceRevision: target.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
    },
    targetEnvironment: target,
  };
}

export async function resolveReplayNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity: string;
  sourceRecord: NixosSharedHostDeployRecord;
  sourceReplaySnapshot: NixosSharedHostReplaySnapshot;
  rollback: boolean;
}): Promise<NixosSharedHostAdmittedContext> {
  const source = opts.sourceReplaySnapshot.admittedContext;
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
  const errors: string[] = [];
  if (source.lanePolicyRef !== opts.deployment.lanePolicyRef) {
    errors.push(
      replayMismatch("lanePolicyRef", opts.deployment.lanePolicyRef, source.lanePolicyRef),
    );
  }
  if (source.lanePolicyFingerprint !== opts.deployment.lanePolicy.fingerprint) {
    errors.push(
      replayMismatch(
        "lanePolicyFingerprint",
        opts.deployment.lanePolicy.fingerprint,
        source.lanePolicyFingerprint,
      ),
    );
  }
  if (source.environmentStage !== opts.deployment.environmentStage) {
    errors.push(
      replayMismatch("environmentStage", opts.deployment.environmentStage, source.environmentStage),
    );
  }
  if (errors.length > 0) {
    throw new Error(`source run is outside current lane policy:
${errors.join("\n")}`);
  }
  if (
    opts.rollback &&
    !(await gitIsAncestor(opts.workspaceRoot, source.source.sourceRevision, target.targetRevision))
  ) {
    throw new Error(
      `rollback source run is outside current lane state: ${opts.sourceRecord.deployRunId}
source revision ${source.source.sourceRevision} is not reachable from ${target.targetRef}`,
    );
  }
  if (
    !opts.rollback &&
    opts.deployment.admissionPolicy.retryBranchPolicy === "branch_coupled" &&
    source.source.sourceRevision !== target.targetRevision
  ) {
    throw new Error(
      `retry source run no longer matches branch-coupled target state: ${opts.sourceRecord.deployRunId}`,
    );
  }
  return {
    ...baseContext(opts.deployment),
    source: {
      ...source.source,
      mode: "source_run_reuse",
      artifactIdentity: opts.artifactIdentity,
      sourceRunId: opts.sourceRecord.deployRunId,
    },
    targetEnvironment: target,
  };
}

export async function resolvePromotionNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string };
}): Promise<NixosSharedHostAdmittedContext> {
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
  return {
    ...baseContext(opts.deployment),
    source: {
      mode: "promotion_source_run",
      sourceRef: target.targetRef,
      sourceRevision: target.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      sourceRunId: opts.sourceRecord.deployRunId,
      sourceDeploymentId: opts.sourceRecord.deploymentId,
    },
    targetEnvironment: target,
  };
}
