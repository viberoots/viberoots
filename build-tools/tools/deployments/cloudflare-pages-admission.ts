#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";

export type CloudflarePagesSourceAdmission = {
  mode: "stage_branch_head";
  sourceRef: string;
  sourceRevision: string;
  artifactIdentity: string;
  artifactTrustMode: "recorded_exact_artifact";
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

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

export async function resolveInitialCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactIdentity: string;
}): Promise<CloudflarePagesAdmittedContext> {
  const targetRef = requiredPolicyRef(opts.deployment);
  const targetRevision = await gitStdout(opts.workspaceRoot, ["rev-parse", targetRef]);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    source: {
      mode: "stage_branch_head",
      sourceRef: targetRef,
      sourceRevision: targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
    },
    targetEnvironment: {
      mode: "stage_branch_snapshot",
      targetRef,
      targetRevision,
      providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
      lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    },
  };
}
