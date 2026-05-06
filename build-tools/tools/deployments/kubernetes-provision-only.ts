#!/usr/bin/env zx-wrapper
import { resolveInitialKubernetesAdmittedContext } from "./kubernetes-admission";
import type { KubernetesAdmittedContext } from "./kubernetes-admission";
import type { KubernetesDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import { createKubernetesDeployRecord, writeKubernetesDeployRecord } from "./kubernetes-records";
import { writeKubernetesProvisionerPlan } from "./kubernetes-provisioner-plan";
import {
  maybeRunOpenTofuReviewedApply,
  type OpenTofuApplyHooks,
} from "./opentofu-apply-orchestration";

export async function submitKubernetesProvisionOnly(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  admittedContext?: KubernetesAdmittedContext;
  openTofuApply?: OpenTofuApplyHooks;
}) {
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const admittedContext =
    opts.admittedContext ||
    (await resolveInitialKubernetesAdmittedContext({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactIdentity: `provision-only:${opts.deployment.providerTarget.providerTargetIdentity}`,
      ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
      ...(opts.expectedSourceRevision
        ? { expectedSourceRevision: opts.expectedSourceRevision }
        : {}),
    }));
  const provisionerPlan = await writeKubernetesProvisionerPlan({
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
        ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
      },
    }));
  const provisionerApplyOutcome = await maybeRunOpenTofuReviewedApply({
    deployment: opts.deployment,
    admittedContext,
    provisionerPlan,
    hooks: opts.openTofuApply,
  });
  const record = createKubernetesDeployRecord(opts.deployment, {
    deployRunId,
    operationKind: "provision_only",
    runClassification: "provision_only",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome:
      provisionerApplyOutcome && provisionerApplyOutcome.status === "failed"
        ? "publish_failed"
        : "succeeded",
    artifact: { identity: admittedContext.source.artifactIdentity },
    componentArtifacts: [],
    admittedContext,
    ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
    ...(provisionerPlan ? { provisionerPlan } : {}),
    ...(provisionerApplyOutcome ? { provisionerApplyOutcome } : {}),
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
  });
  return { record, recordPath: await writeKubernetesDeployRecord(opts.recordsRoot, record) };
}
