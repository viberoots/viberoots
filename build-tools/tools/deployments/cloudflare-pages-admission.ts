#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import type { DeploymentRequirement } from "./deployment-requirements";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec";
import {
  resolveDeploymentReviewedTargetEnvironment,
  type DeploymentReviewedTargetEnvironmentAdmission,
} from "./deployment-reviewed-target-environment";

export type CloudflarePagesSourceAdmission = {
  mode: "stage_branch_head" | "source_run_reuse" | "promotion_source_run";
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
} & Pick<DeploymentReviewedTargetEnvironmentAdmission, "reviewedSourceSnapshot">;

export type CloudflarePagesAdmittedContext = {
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
  source: CloudflarePagesSourceAdmission;
  targetEnvironment: CloudflarePagesTargetEnvironmentAdmission;
};

async function baseContext(
  deployment: CloudflarePagesDeployment,
  targetScope: string,
  sourceAdmittedContext?: {
    secretRequirements?: DeploymentRequirement[];
    admittedSecretReferences?: unknown[];
  },
  opts?: {
    secretContext?: DeploymentSecretContext;
    deferSecretReferenceResolution?: boolean;
  },
) {
  const sourceAdmittedReferences = Array.isArray(sourceAdmittedContext?.admittedSecretReferences)
    ? (sourceAdmittedContext.admittedSecretReferences as DeploymentSecretAdmittedReference[])
    : [];
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
    secretRequirements: deployment.secretRequirements,
    admittedSecretReferences: opts?.deferSecretReferenceResolution
      ? sourceAdmittedReferences
      : sourceAdmittedContext
        ? await resolveSourceRunAdmittedSecretReferences({
            sourceAdmittedContext: sourceAdmittedContext as any,
            requirements: deployment.secretRequirements,
            targetScope,
            secretContext: opts?.secretContext,
          })
        : await resolveInitialAdmittedSecretReferences({
            requirements: deployment.secretRequirements,
            targetScope,
            secretContext: opts?.secretContext,
          }),
    runtimeConfigRequirements: deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references" as const,
      runtimeConfig: "exact_contract_ids" as const,
    },
    targetExceptionRefs: deployment.targetExceptions.map((exception) => exception.ref).sort(),
  };
}

async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: CloudflarePagesDeployment,
  submissionId?: string,
  expectedSourceRevision?: string,
): Promise<CloudflarePagesTargetEnvironmentAdmission> {
  return await resolveDeploymentReviewedTargetEnvironment({
    workspaceRoot,
    deployment,
    ...(submissionId ? { submissionId } : {}),
    ...(expectedSourceRevision ? { expectedSourceRevision } : {}),
  });
}

export async function resolveInitialCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactIdentity: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
}): Promise<CloudflarePagesAdmittedContext> {
  const target = await targetEnvironmentAdmission(
    opts.workspaceRoot,
    opts.deployment,
    opts.submissionId,
    opts.expectedSourceRevision,
  );
  return {
    ...(await baseContext(opts.deployment, target.lockScope, undefined, opts)),
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
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
}): Promise<CloudflarePagesAdmittedContext> {
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
  return {
    ...(await baseContext(opts.deployment, target.lockScope, undefined, opts)),
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

export async function resolveSourceRunCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
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
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
}): Promise<CloudflarePagesAdmittedContext> {
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
  return {
    ...(await baseContext(
      opts.deployment,
      target.lockScope,
      opts.sourceRecord.admittedContext,
      opts,
    )),
    source: {
      mode: "source_run_reuse",
      sourceRef: opts.sourceRecord.admittedContext?.source?.sourceRef || target.targetRef,
      sourceRevision:
        opts.sourceRecord.admittedContext?.source?.sourceRevision || target.targetRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
      sourceRunId: opts.sourceRecord.deployRunId,
      sourceDeploymentId: opts.sourceRecord.deploymentId,
    },
    targetEnvironment: target,
  };
}

export async function resolveCloudflarePagesAdmittedSecretReferences(opts: {
  deployment: CloudflarePagesDeployment;
  admittedContext: CloudflarePagesAdmittedContext;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  return await resolveSourceRunAdmittedSecretReferences({
    sourceAdmittedContext: opts.admittedContext,
    requirements: opts.deployment.secretRequirements,
    targetScope: opts.admittedContext.targetEnvironment.lockScope,
    secretContext: opts.secretContext,
  });
}
