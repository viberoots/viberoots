#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";

export type S3StaticAdmittedContext = {
  lanePolicyRef: string;
  lanePolicyFingerprint: string;
  admissionPolicyRef: string;
  admissionPolicyFingerprint: string;
  environmentStage: string;
  secretRequirements: DeploymentRequirement[];
  runtimeConfigRequirements: DeploymentRequirement[];
  referenceResolutionPolicy: {
    secrets: "exact_contract_ids";
    runtimeConfig: "exact_contract_ids";
  };
  targetExceptionRefs: string[];
  policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
  source: {
    mode: "stage_branch_head";
    sourceRef: string;
    sourceRevision: string;
    artifactIdentity: string;
    artifactTrustMode: "recorded_exact_artifact";
  };
  targetEnvironment: {
    mode: "stage_branch_snapshot";
    targetRef: string;
    targetRevision: string;
    providerTargetIdentity: string;
    lockScope: string;
  };
};

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

export async function resolveInitialS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
}): Promise<S3StaticAdmittedContext> {
  const sourceRef = requiredDeploymentStageBranch(opts.deployment);
  if (!opts.deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${opts.deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  const sourceRevision = await gitStdout(opts.workspaceRoot, ["rev-parse", sourceRef]);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretRequirements: opts.deployment.secretRequirements,
    runtimeConfigRequirements: opts.deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_contract_ids",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: opts.deployment.targetExceptions.map((entry) => entry.ref).sort(),
    source: {
      mode: "stage_branch_head",
      sourceRef,
      sourceRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
    },
    targetEnvironment: {
      mode: "stage_branch_snapshot",
      targetRef: sourceRef,
      targetRevision: sourceRevision,
      providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
      lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    },
  };
}
