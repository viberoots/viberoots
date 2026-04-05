#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";

export type CloudflarePagesSourceAdmission = {
  mode: "stage_branch_head" | "promotion_source_run";
  sourceRef: string;
  sourceRevision: string;
  artifactIdentity: string;
  artifactTrustMode: "recorded_exact_artifact";
  sourceRunId?: string;
  sourceDeploymentId?: string;
};

export type CloudflarePagesTargetEnvironmentAdmission = {
  mode: "stage_branch_snapshot";
  targetRef: string;
  targetRevision: string;
  providerTargetIdentity: string;
  lockScope: string;
};

export type CloudflarePagesAdmittedContext = {
  lanePolicyRef: string;
  lanePolicyFingerprint: string;
  admissionPolicyRef: string;
  admissionPolicyFingerprint: string;
  environmentStage: string;
  source: CloudflarePagesSourceAdmission;
  targetEnvironment: CloudflarePagesTargetEnvironmentAdmission;
};

function requiredPolicyRef(deployment: CloudflarePagesDeployment): string {
  const sourceRef = requiredDeploymentStageBranch(deployment);
  if (!deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  return sourceRef;
}

function baseContext(deployment: CloudflarePagesDeployment) {
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

async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: CloudflarePagesDeployment,
): Promise<CloudflarePagesTargetEnvironmentAdmission> {
  const targetRef = requiredPolicyRef(deployment);
  const targetRevision = await gitStdout(workspaceRoot, ["rev-parse", targetRef]);
  return {
    mode: "stage_branch_snapshot",
    targetRef,
    targetRevision,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    lockScope: deployment.providerTarget.providerTargetIdentity,
  };
}

export async function resolveInitialCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactIdentity: string;
}): Promise<CloudflarePagesAdmittedContext> {
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

export async function resolvePromotionCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string };
}): Promise<CloudflarePagesAdmittedContext> {
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
