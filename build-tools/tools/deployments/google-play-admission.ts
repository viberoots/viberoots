#!/usr/bin/env zx-wrapper
import type { GooglePlayDeployment } from "./contract";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import type { DeploymentRequirement } from "./deployment-requirements";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec";
import {
  resolveDeploymentReviewedTargetEnvironment,
  type DeploymentReviewedTargetEnvironmentAdmission,
} from "./deployment-reviewed-target-environment";

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
  admittedSecretReferences: DeploymentSecretAdmittedReference[];
  runtimeConfigRequirements: DeploymentRequirement[];
  referenceResolutionPolicy: {
    secrets: "exact_admitted_references";
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
  } & Pick<DeploymentReviewedTargetEnvironmentAdmission, "reviewedSourceSnapshot">;
};

async function baseContext(
  deployment: GooglePlayDeployment,
  targetScope: string,
  sourceAdmittedContext?: {
    secretRequirements?: DeploymentRequirement[];
    admittedSecretReferences?: unknown[];
  },
) {
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
    secretRequirements: deployment.secretRequirements,
    admittedSecretReferences: sourceAdmittedContext
      ? await resolveSourceRunAdmittedSecretReferences({
          sourceAdmittedContext: sourceAdmittedContext as any,
          requirements: deployment.secretRequirements,
          targetScope,
        })
      : await resolveInitialAdmittedSecretReferences({
          requirements: deployment.secretRequirements,
          targetScope,
        }),
    runtimeConfigRequirements: deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references" as const,
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
  submissionId?: string;
  expectedSourceRevision?: string;
}): Promise<GooglePlayAdmittedContext> {
  const target = await resolveDeploymentReviewedTargetEnvironment(opts);
  return {
    ...(await baseContext(
      opts.deployment,
      target.lockScope,
      opts.mode === "source_run_reuse" ? opts.sourceRecord?.admittedContext : undefined,
    )),
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
  submissionId?: string;
  expectedSourceRevision?: string;
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
