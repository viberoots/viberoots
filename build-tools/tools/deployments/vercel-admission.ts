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
  const admittedSecretReferences = await resolveInitialAdmittedSecretReferences({
    requirements: opts.deployment.secretRequirements,
    targetScope: target.lockScope,
  });
  return vercelAdmittedContext({
    deployment: opts.deployment,
    target,
    artifactIdentity: opts.artifactIdentity,
    admittedSecretReferences,
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
  });
}

function vercelAdmittedContext(opts: {
  deployment: VercelDeployment;
  target: DeploymentReviewedTargetEnvironmentAdmission;
  artifactIdentity: string;
  admittedSecretReferences: DeploymentSecretAdmittedReference[];
  sourceRunId?: string;
}): VercelAdmittedContext {
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretRequirements: opts.deployment.secretRequirements,
    admittedSecretReferences: opts.admittedSecretReferences,
    runtimeConfigRequirements: opts.deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: opts.deployment.targetExceptions.map((entry) => entry.ref).sort(),
    source: {
      mode: "stage_branch_head",
      sourceRef: opts.target.targetRef,
      sourceRevision: opts.target.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    },
    targetEnvironment: opts.target,
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
  const target = await resolveDeploymentReviewedTargetEnvironment({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    ...(opts.expectedSourceRevision ? { expectedSourceRevision: opts.expectedSourceRevision } : {}),
  });
  const admittedSecretReferences = await resolveSourceRunAdmittedSecretReferences({
    sourceAdmittedContext: opts.sourceRecord.admittedContext,
    requirements: opts.deployment.secretRequirements,
    targetScope: target.lockScope,
  });
  const admitted = vercelAdmittedContext({
    deployment: opts.deployment,
    target,
    artifactIdentity: opts.artifactIdentity,
    admittedSecretReferences,
    sourceRunId: opts.sourceRecord.deployRunId,
  });
  return {
    ...admitted,
    source: {
      ...admitted.source,
      sourceRef: source.sourceRef,
      sourceRevision: source.sourceRevision,
    },
  };
}
