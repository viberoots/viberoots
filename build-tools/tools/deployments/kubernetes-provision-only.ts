#!/usr/bin/env zx-wrapper
import { resolveInitialKubernetesAdmittedContext } from "./kubernetes-admission.ts";
import type { KubernetesDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { createKubernetesDeployRecord, writeKubernetesDeployRecord } from "./kubernetes-records.ts";
import { writeKubernetesProvisionerPlan } from "./kubernetes-provisioner-plan.ts";

export async function submitKubernetesProvisionOnly(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const admittedContext = await resolveInitialKubernetesAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: `provision-only:${opts.deployment.providerTarget.providerTargetIdentity}`,
    ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
    ...(opts.expectedSourceRevision ? { expectedSourceRevision: opts.expectedSourceRevision } : {}),
  });
  const provisionerPlan = await writeKubernetesProvisionerPlan({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployRunId,
    deployment: opts.deployment,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: "provision_only",
    admittedContext,
    evidence: {
      ...(opts.admissionEvidence || {}),
      ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
    },
  });
  const record = createKubernetesDeployRecord(opts.deployment, {
    deployRunId,
    operationKind: "provision_only",
    runClassification: "provision_only",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: "succeeded",
    artifact: { identity: admittedContext.source.artifactIdentity },
    componentArtifacts: [],
    admittedContext,
    ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
    ...(provisionerPlan ? { provisionerPlan } : {}),
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
  });
  return { record, recordPath: await writeKubernetesDeployRecord(opts.recordsRoot, record) };
}
