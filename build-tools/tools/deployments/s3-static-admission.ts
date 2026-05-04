#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract";
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

export type S3StaticAdmittedContext = {
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
  } & Pick<DeploymentReviewedTargetEnvironmentAdmission, "reviewedSourceSnapshot">;
};

export async function resolveInitialS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
  submissionId?: string;
  expectedSourceRevision?: string;
}): Promise<S3StaticAdmittedContext> {
  const target = await resolveDeploymentReviewedTargetEnvironment(opts);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretRequirements: opts.deployment.secretRequirements,
    admittedSecretReferences: await resolveInitialAdmittedSecretReferences({
      requirements: opts.deployment.secretRequirements,
      targetScope: target.lockScope,
    }),
    runtimeConfigRequirements: opts.deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: opts.deployment.targetExceptions.map((entry) => entry.ref).sort(),
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

export async function resolvePromotionS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string };
  submissionId?: string;
  expectedSourceRevision?: string;
}): Promise<S3StaticAdmittedContext> {
  const admitted = await resolveInitialS3StaticAdmittedContext(opts);
  return {
    ...admitted,
    source: {
      mode: "stage_branch_head",
      sourceRef: admitted.targetEnvironment.targetRef,
      sourceRevision: admitted.targetEnvironment.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      sourceRunId: opts.sourceRecord.deployRunId,
      sourceDeploymentId: opts.sourceRecord.deploymentId,
    } as S3StaticAdmittedContext["source"] & {
      sourceRunId: string;
      sourceDeploymentId: string;
    },
  };
}

export async function resolveSourceRunS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
  sourceRecord: {
    deployRunId: string;
    deploymentId: string;
    admittedContext?: {
      source?: {
        sourceRef?: string;
        sourceRevision?: string;
      };
    };
  };
  submissionId?: string;
  expectedSourceRevision?: string;
}): Promise<S3StaticAdmittedContext> {
  const admitted = await resolveInitialS3StaticAdmittedContext(opts);
  return {
    ...admitted,
    admittedSecretReferences: await resolveSourceRunAdmittedSecretReferences({
      sourceAdmittedContext: opts.sourceRecord.admittedContext,
      requirements: opts.deployment.secretRequirements,
      targetScope: admitted.targetEnvironment.lockScope,
    }),
    source: {
      mode: "stage_branch_head",
      sourceRef: opts.sourceRecord.admittedContext?.source?.sourceRef || admitted.source.sourceRef,
      sourceRevision:
        opts.sourceRecord.admittedContext?.source?.sourceRevision || admitted.source.sourceRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      sourceRunId: opts.sourceRecord.deployRunId,
      sourceDeploymentId: opts.sourceRecord.deploymentId,
    } as S3StaticAdmittedContext["source"] & {
      sourceRunId: string;
      sourceDeploymentId: string;
    },
  };
}
