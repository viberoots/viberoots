#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec.ts";

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
};

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

function requiredPolicyRef(deployment: CloudflarePagesDeployment): string {
  const sourceRef = requiredDeploymentStageBranch(deployment);
  if (!deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  return sourceRef;
}

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

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

async function targetEnvironmentAdmission(
  workspaceRoot: string,
  deployment: CloudflarePagesDeployment,
): Promise<CloudflarePagesTargetEnvironmentAdmission> {
  const targetRef = requiredPolicyRef(deployment);
  const targetRevision = await gitStdout(workspaceRoot, ["rev-parse", targetRef]);
  return {
    mode: "stage_branch_snapshot",
    targetRef,
    targetRevision,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    lockScope: deployment.providerTarget.providerTargetIdentity,
  };
}

export async function resolveInitialCloudflarePagesAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactIdentity: string;
  secretContext?: DeploymentSecretContext;
  deferSecretReferenceResolution?: boolean;
}): Promise<CloudflarePagesAdmittedContext> {
  const target = await targetEnvironmentAdmission(opts.workspaceRoot, opts.deployment);
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
