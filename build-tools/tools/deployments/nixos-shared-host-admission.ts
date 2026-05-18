#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import {
  requirementSummary,
  sameRequirementSet,
  type DeploymentRequirement,
} from "./deployment-requirements";
import type * as Sprinkle from "./deployment-sprinkle-ref";
import {
  replayMismatch,
  resolveNixosSharedHostAdmittedSecretReferences,
  targetEnvironmentAdmission,
  type NixosSharedHostTargetEnvironmentAdmission,
} from "./nixos-shared-host-admission-helpers";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay";
import type { DeploymentReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";
export type NixosSharedHostSourceAdmission = {
  mode: "reviewed_source_ref" | "source_run_reuse" | "promotion_source_run";
  sourceRef: string;
  sourceRevision: string;
  artifactIdentity?: string;
  artifactTrustMode: "recorded_exact_artifact";
  sourceRunId?: string;
  sourceDeploymentId?: string;
};

export type NixosSharedHostAdmittedContext = {
  lanePolicyRef: string;
  lanePolicyFingerprint: string;
  admissionPolicyRef: string;
  admissionPolicyFingerprint: string;
  environmentStage: string;
  secretBackend?: Sprinkle.DeploymentSecretBackendKind;
  secretBackendProfile?: string;
  infisicalRuntime?: NixosSharedHostDeployment["infisicalRuntime"];
  infisicalSecretMappings?: NixosSharedHostDeployment["infisicalSecretMappings"];
  secretRequirements: DeploymentRequirement[];
  admittedSecretReferences: DeploymentSecretAdmittedReference[];
  runtimeConfigRequirements: DeploymentRequirement[];
  referenceResolutionPolicy: {
    secrets: "exact_admitted_references";
    runtimeConfig: "exact_contract_ids";
  };
  targetExceptionRefs: string[];
  policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
  source: NixosSharedHostSourceAdmission;
  targetEnvironment: NixosSharedHostTargetEnvironmentAdmission;
};

async function baseContext(
  deployment: NixosSharedHostDeployment,
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
    ? (sourceAdmittedContext.admittedSecretReferences as Sprinkle.DeploymentSecretAdmittedReference[])
    : [];
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
    secretBackend: deployment.secretBackend || "vault",
    secretBackendProfile: deployment.secretBackendProfile,
    ...(deployment.infisicalRuntime ? { infisicalRuntime: deployment.infisicalRuntime } : {}),
    ...(deployment.infisicalSecretMappings
      ? { infisicalSecretMappings: deployment.infisicalSecretMappings }
      : {}),
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
            secretBackend: deployment.secretBackend,
            secretBackendProfile: deployment.secretBackendProfile,
            vaultRuntime: deployment.vaultRuntime,
            infisicalRuntime: deployment.infisicalRuntime,
            infisicalSecretMappings: deployment.infisicalSecretMappings,
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

export async function resolveInitialNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity?: string;
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
}): Promise<NixosSharedHostAdmittedContext> {
  const target = await targetEnvironmentAdmission(
    opts.workspaceRoot,
    opts.deployment,
    opts.reviewedSourceSnapshot,
  );
  return {
    ...(await baseContext(opts.deployment, target.lockScope, undefined, opts)),
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

export async function resolveReplayNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity?: string;
  sourceRecord: NixosSharedHostDeployRecord;
  sourceReplaySnapshot: NixosSharedHostReplaySnapshot;
  rollback: boolean;
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
}): Promise<NixosSharedHostAdmittedContext> {
  const source = opts.sourceReplaySnapshot.admittedContext;
  const target = await targetEnvironmentAdmission(
    opts.workspaceRoot,
    opts.deployment,
    opts.reviewedSourceSnapshot,
  );
  const errors: string[] = [];
  if (source.lanePolicyRef !== opts.deployment.lanePolicyRef)
    errors.push(
      replayMismatch("lanePolicyRef", opts.deployment.lanePolicyRef, source.lanePolicyRef),
    );
  if (source.lanePolicyFingerprint !== opts.deployment.lanePolicy.fingerprint)
    errors.push(
      replayMismatch(
        "lanePolicyFingerprint",
        opts.deployment.lanePolicy.fingerprint,
        source.lanePolicyFingerprint,
      ),
    );
  if (source.environmentStage !== opts.deployment.environmentStage)
    errors.push(
      replayMismatch("environmentStage", opts.deployment.environmentStage, source.environmentStage),
    );
  if (!sameRequirementSet(source.secretRequirements, opts.deployment.secretRequirements)) {
    errors.push(
      replayMismatch(
        "secretRequirements",
        requirementSummary(opts.deployment.secretRequirements),
        requirementSummary(source.secretRequirements),
      ),
    );
  }
  if (
    !sameRequirementSet(source.runtimeConfigRequirements, opts.deployment.runtimeConfigRequirements)
  ) {
    errors.push(
      replayMismatch(
        "runtimeConfigRequirements",
        requirementSummary(opts.deployment.runtimeConfigRequirements),
        requirementSummary(source.runtimeConfigRequirements),
      ),
    );
  }
  if (errors.length > 0) {
    throw new Error(`source run is outside current lane policy:
${errors.join("\n")}`);
  }
  if (
    !opts.rollback &&
    opts.deployment.admissionPolicy.retryBranchPolicy === "branch_coupled" &&
    source.source.sourceRevision !== target.targetRevision
  ) {
    throw new Error(
      `retry source run no longer matches branch-coupled target state: ${opts.sourceRecord.deployRunId}`,
    );
  }
  return {
    ...(await baseContext(
      opts.deployment,
      target.lockScope,
      opts.sourceReplaySnapshot.admittedContext,
      opts,
    )),
    source: {
      ...source.source,
      mode: "source_run_reuse",
      artifactIdentity: opts.artifactIdentity,
      sourceRunId: opts.sourceRecord.deployRunId,
    },
    targetEnvironment: target,
  };
}

export async function resolvePromotionNixosSharedHostAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity?: string;
  sourceRecord: { deployRunId: string; deploymentId: string };
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
}): Promise<NixosSharedHostAdmittedContext> {
  const target = await targetEnvironmentAdmission(
    opts.workspaceRoot,
    opts.deployment,
    opts.reviewedSourceSnapshot,
  );
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
