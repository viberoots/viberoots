#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { OpenTofuDeployment } from "./contract";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers";
import {
  createProductionFoundationMigrationAdapter,
  runFoundationMigrationApply,
  type FoundationMigrationAdapter,
} from "./foundation-migration";
import {
  createOpenTofuFoundationRecord,
  writeOpenTofuFoundationRecord,
} from "./opentofu-foundation-records";
import {
  createProductionOpenTofuApplyAdapter,
  runOpenTofuReviewedApply,
  type OpenTofuApplyAdapter,
  type OpenTofuApplyEvidence,
} from "./opentofu-apply";
import {
  resolveInitialOpenTofuAdmittedContext,
  type OpenTofuAdmittedContext,
} from "./opentofu-admission";
import { writeOpenTofuProvisionerPlan } from "./opentofu-provisioner-plan";

export type OpenTofuFoundationHooks = {
  openTofuAdapter?: OpenTofuApplyAdapter;
  migrationAdapter?: FoundationMigrationAdapter;
  evidence?: OpenTofuApplyEvidence;
  secretRuntimeFactory?: (opts: {
    deployment: OpenTofuDeployment;
    admittedContext: OpenTofuAdmittedContext;
  }) => { enterStep(step: "provision"): Promise<Record<string, string>> };
};

function supabaseIdentity(deployment: OpenTofuDeployment): string {
  const contract = deployment.secretRequirements.find(
    (requirement) => requirement.step === "provision" && requirement.name.includes("supabase"),
  )?.contractId;
  if (contract) return contract.replace(/^secret:\/\//, "supabase://");
  return `supabase://${deployment.deploymentId}`;
}

export async function submitOpenTofuFoundationProvisionOnly(opts: {
  workspaceRoot: string;
  deployment: OpenTofuDeployment;
  recordsRoot: string;
  migrationBundleArtifactPath: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  admittedContext?: OpenTofuAdmittedContext;
  hooks?: OpenTofuFoundationHooks;
}) {
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const artifactIdentity = `migration-bundle:${opts.deployment.migrationBundleRef || opts.deployment.component.target}`;
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(opts.admissionEvidence);
  const admittedContext =
    opts.admittedContext ||
    (await resolveInitialOpenTofuAdmittedContext({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactIdentity,
      ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
      ...(opts.expectedSourceRevision
        ? { expectedSourceRevision: opts.expectedSourceRevision }
        : {}),
      ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
    }));
  const provisionerPlan = await writeOpenTofuProvisionerPlan({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployRunId,
    deployment: opts.deployment,
  });
  admittedContext.policyEvaluation =
    admittedContext.policyEvaluation ||
    (await evaluateDeploymentAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      operationKind: "provision_only",
      admittedContext,
      evidence: {
        ...(opts.admissionEvidence || {}),
        provisionerPlanFingerprint: provisionerPlan.fingerprint,
      },
    }));
  const secretRuntime =
    opts.hooks?.secretRuntimeFactory?.({ deployment: opts.deployment, admittedContext }) ||
    createVaultDeploymentSecretRuntime({
      admittedContext,
      fallbackTargetScope: admittedContext.targetEnvironment.lockScope,
    });
  const provisionerApplyOutcome = await runOpenTofuReviewedApply({
    provisioner: opts.deployment.provisioner,
    provisionerPlan,
    admittedProvisionerPlanFingerprint:
      admittedContext.policyEvaluation.binding.provisionerPlanFingerprint,
    secretRuntime,
    adapter: opts.hooks?.openTofuAdapter || createProductionOpenTofuApplyAdapter(),
    ...(opts.hooks?.evidence ? { evidence: opts.hooks.evidence } : {}),
  });
  const foundationMigrationOutcome = await runFoundationMigrationApply({
    bundlePath: opts.migrationBundleArtifactPath,
    targetSupabaseIdentity: supabaseIdentity(opts.deployment),
    sourceRevision: admittedContext.source.sourceRevision,
    secretRuntime,
    adapter: opts.hooks?.migrationAdapter || createProductionFoundationMigrationAdapter(),
  });
  const record = createOpenTofuFoundationRecord({
    deployment: opts.deployment,
    deployRunId,
    artifactIdentity,
    admittedContext,
    provisionerPlan,
    provisionerApplyOutcome,
    foundationMigrationOutcome,
  });
  return { record, recordPath: await writeOpenTofuFoundationRecord(opts.recordsRoot, record) };
}
