#!/usr/bin/env zx-wrapper
import type { GooglePlayDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";

type GooglePlaySourceAdmission = {
  mode: "stage_branch_head" | "source_run_reuse" | "promotion_source_run";
  sourceRef: string;
  sourceRevision: string;
  artifactIdentity: string;
  artifactTrustMode: "recorded_exact_artifact";
  sourceRunId?: string;
  sourceDeploymentId?: string;
};

export type GooglePlayAdmittedContext = {
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
  source: GooglePlaySourceAdmission;
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
  if ((out as any).exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  return String((out as any).stdout || "").trim();
}

async function targetEnvironment(workspaceRoot: string, deployment: GooglePlayDeployment) {
  const targetRef = requiredDeploymentStageBranch(deployment);
  if (!deployment.admissionPolicy.allowedRefs.includes(targetRef)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${targetRef}`,
    );
  }
  return {
    mode: "stage_branch_snapshot" as const,
    targetRef,
    targetRevision: await gitStdout(workspaceRoot, ["rev-parse", targetRef]),
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    lockScope: deployment.providerTarget.providerTargetIdentity,
  };
}

function baseContext(deployment: GooglePlayDeployment) {
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
    secretRequirements: deployment.secretRequirements,
    runtimeConfigRequirements: deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_contract_ids" as const,
      runtimeConfig: "exact_contract_ids" as const,
    },
    targetExceptionRefs: deployment.targetExceptions.map((entry) => entry.ref).sort(),
  };
}

async function admittedContextFor(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactIdentity: string;
  mode: GooglePlaySourceAdmission["mode"];
  sourceRecord?: { deployRunId: string; deploymentId: string; admittedContext?: any };
}): Promise<GooglePlayAdmittedContext> {
  const target = await targetEnvironment(opts.workspaceRoot, opts.deployment);
  return {
    ...baseContext(opts.deployment),
    source: {
      mode: opts.mode,
      sourceRef: opts.sourceRecord?.admittedContext?.source?.sourceRef || target.targetRef,
      sourceRevision:
        opts.sourceRecord?.admittedContext?.source?.sourceRevision || target.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      ...(opts.sourceRecord ? { sourceRunId: opts.sourceRecord.deployRunId } : {}),
      ...(opts.sourceRecord ? { sourceDeploymentId: opts.sourceRecord.deploymentId } : {}),
    },
    targetEnvironment: target,
  };
}

export async function resolveInitialGooglePlayAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactIdentity: string;
}) {
  return await admittedContextFor({ ...opts, mode: "stage_branch_head" });
}

export async function resolvePromotionGooglePlayAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string; admittedContext?: any };
}) {
  return await admittedContextFor({ ...opts, mode: "promotion_source_run" });
}

export async function resolveSourceRunGooglePlayAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string; admittedContext?: any };
}) {
  return await admittedContextFor({ ...opts, mode: "source_run_reuse" });
}
