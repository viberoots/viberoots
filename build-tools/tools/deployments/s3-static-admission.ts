#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "./deployment-secret-admission.ts";
import type { DeploymentSecretAdmittedReference } from "./deployment-secretspec.ts";

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
  };
};

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

export async function resolveInitialS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
}): Promise<S3StaticAdmittedContext> {
  const sourceRef = requiredDeploymentStageBranch(opts.deployment);
  if (!opts.deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${opts.deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  const sourceRevision = await gitStdout(opts.workspaceRoot, ["rev-parse", sourceRef]);
  return {
    lanePolicyRef: opts.deployment.lanePolicyRef,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    environmentStage: opts.deployment.environmentStage,
    secretRequirements: opts.deployment.secretRequirements,
    admittedSecretReferences: await resolveInitialAdmittedSecretReferences({
      requirements: opts.deployment.secretRequirements,
      targetScope: opts.deployment.providerTarget.providerTargetIdentity,
    }),
    runtimeConfigRequirements: opts.deployment.runtimeConfigRequirements,
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: opts.deployment.targetExceptions.map((entry) => entry.ref).sort(),
    source: {
      mode: "stage_branch_head",
      sourceRef,
      sourceRevision,
      artifactIdentity: opts.artifactIdentity,
      artifactTrustMode: opts.deployment.admissionPolicy.artifactAttestationMode,
    },
    targetEnvironment: {
      mode: "stage_branch_snapshot",
      targetRef: sourceRef,
      targetRevision: sourceRevision,
      providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
      lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    },
  };
}

export async function resolvePromotionS3StaticAdmittedContext(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactIdentity: string;
  sourceRecord: { deployRunId: string; deploymentId: string };
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
