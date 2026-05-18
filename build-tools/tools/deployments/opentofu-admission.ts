#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import type { DeploymentRequirement } from "./deployment-requirements";
import { resolveInitialAdmittedSecretReferences } from "./deployment-secret-admission";
import type {
  DeploymentSecretAdmittedReference,
  DeploymentSecretBackendKind,
} from "./deployment-sprinkle-ref";
import {
  resolveDeploymentReviewedTargetEnvironment,
  type DeploymentReviewedTargetEnvironmentAdmission,
} from "./deployment-reviewed-target-environment";
import type { OpenTofuDeployment } from "./contract";

export type OpenTofuAdmittedContext = {
  lanePolicyRef: string;
  lanePolicyFingerprint: string;
  admissionPolicyRef: string;
  admissionPolicyFingerprint: string;
  environmentStage: string;
  secretBackend?: DeploymentSecretBackendKind;
  secretBackendProfile?: string;
  infisicalRuntime?: OpenTofuDeployment["infisicalRuntime"];
  infisicalSecretMappings?: OpenTofuDeployment["infisicalSecretMappings"];
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

export async function resolveInitialOpenTofuAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: OpenTofuDeployment;
  artifactIdentity: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  requestedSourceRef?: string;
}): Promise<OpenTofuAdmittedContext> {
  const target = await resolveDeploymentReviewedTargetEnvironment(opts);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretBackend: opts.deployment.secretBackend || "vault",
    secretBackendProfile: opts.deployment.secretBackendProfile,
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
      secretBackendProfile: opts.deployment.secretBackendProfile,
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
