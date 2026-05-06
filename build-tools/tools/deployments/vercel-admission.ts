#!/usr/bin/env zx-wrapper
import type { VercelDeployment } from "./contract";
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

export type VercelAdmittedContext = {
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
    sourceRunId?: string;
  };
  targetEnvironment: {
    mode: "stage_branch_snapshot";
    targetRef: string;
    targetRevision: string;
    providerTargetIdentity: string;
    lockScope: string;
  } & Pick<DeploymentReviewedTargetEnvironmentAdmission, "reviewedSourceSnapshot">;
};

export async function resolveInitialVercelAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  artifactIdentity: string;
  sourceRunId?: string;
  expectedSourceRevision?: string;
}): Promise<VercelAdmittedContext> {
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
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    },
    targetEnvironment: target,
  };
}

export async function resolveSourceRunVercelAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; admittedContext?: any };
  expectedSourceRevision?: string;
}): Promise<VercelAdmittedContext> {
  const source = opts.sourceRecord.admittedContext?.source;
  if (!source?.sourceRef || !source?.sourceRevision) {
    throw new Error("vercel replay requires recorded admitted source snapshot");
  }
  const admitted = await resolveInitialVercelAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: opts.artifactIdentity,
    sourceRunId: opts.sourceRecord.deployRunId,
    ...(opts.expectedSourceRevision ? { expectedSourceRevision: opts.expectedSourceRevision } : {}),
  });
  return {
    ...admitted,
    admittedSecretReferences: await resolveSourceRunAdmittedSecretReferences({
      sourceAdmittedContext: opts.sourceRecord.admittedContext,
      requirements: opts.deployment.secretRequirements,
      targetScope: admitted.targetEnvironment.lockScope,
    }),
    source: {
      ...admitted.source,
      sourceRef: source.sourceRef,
      sourceRevision: source.sourceRevision,
    },
  };
}
