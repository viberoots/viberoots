#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import type { DeploymentRequirement } from "./deployment-requirements";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission";
import type {
  DeploymentSecretAdmittedReference,
  DeploymentSecretBackendKind,
} from "./deployment-sprinkle-ref";
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
  secretBackend?: DeploymentSecretBackendKind;
  infisicalRuntime?: S3StaticDeployment["infisicalRuntime"];
  infisicalSecretMappings?: S3StaticDeployment["infisicalSecretMappings"];
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
    mode: "reviewed_source_ref";
    sourceRef: string;
    sourceRevision: string;
    artifactIdentity: string;
    artifactTrustMode: "recorded_exact_artifact";
  };
  targetEnvironment: {
    mode: "reviewed_source_snapshot";
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
  requestedSourceRef?: string;
}): Promise<S3StaticAdmittedContext> {
  const target = await resolveDeploymentReviewedTargetEnvironment(opts);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretBackend: opts.deployment.secretBackend || "vault",
    ...(opts.deployment.infisicalRuntime
      ? { infisicalRuntime: opts.deployment.infisicalRuntime }
      : {}),
    ...(opts.deployment.infisicalSecretMappings
      ? { infisicalSecretMappings: opts.deployment.infisicalSecretMappings }
      : {}),
    secretRequirements: opts.deployment.secretRequirements,
    admittedSecretReferences: await resolveInitialAdmittedSecretReferences({
      requirements: opts.deployment.secretRequirements,
      targetScope: target.lockScope,
      secretBackend: opts.deployment.secretBackend,
      vaultRuntime: opts.deployment.vaultRuntime,
      infisicalRuntime: opts.deployment.infisicalRuntime,
      infisicalSecretMappings: opts.deployment.infisicalSecretMappings,
    }),
    runtimeConfigRequirements: opts.deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: opts.deployment.targetExceptions.map((entry) => entry.ref).sort(),
    source: {
      mode: "reviewed_source_ref",
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
  requestedSourceRef?: string;
}): Promise<S3StaticAdmittedContext> {
  const admitted = await resolveInitialS3StaticAdmittedContext(opts);
  return {
    ...admitted,
    source: {
      mode: "reviewed_source_ref",
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
  requestedSourceRef?: string;
}): Promise<S3StaticAdmittedContext> {
  const admitted = await resolveInitialS3StaticAdmittedContext(opts);
  const source = opts.sourceRecord.admittedContext?.source;
  if (!source?.sourceRef || !source?.sourceRevision) {
    throw new Error("s3-static replay requires recorded admitted source snapshot");
  }
  return {
    ...admitted,
    admittedSecretReferences: await resolveSourceRunAdmittedSecretReferences({
      sourceAdmittedContext: opts.sourceRecord.admittedContext,
      requirements: opts.deployment.secretRequirements,
      targetScope: admitted.targetEnvironment.lockScope,
    }),
    source: {
      mode: "reviewed_source_ref",
      sourceRef: source.sourceRef,
      sourceRevision: source.sourceRevision,
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
