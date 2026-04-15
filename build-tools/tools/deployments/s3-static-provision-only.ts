#!/usr/bin/env zx-wrapper
import { resolveInitialS3StaticAdmittedContext } from "./s3-static-admission.ts";
import type { S3StaticDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { createS3StaticDeployRecord, writeS3StaticDeployRecord } from "./s3-static-records.ts";
import { writeS3StaticProvisionerPlan } from "./s3-static-provisioner-plan.ts";

export async function submitS3StaticProvisionOnly(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  recordsRoot: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const admittedContext = await resolveInitialS3StaticAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: `provision-only:${opts.deployment.providerTarget.providerTargetIdentity}`,
  });
  const provisionerPlan = await writeS3StaticProvisionerPlan({
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
  const record = createS3StaticDeployRecord(opts.deployment, {
    deployRunId,
    operationKind: "provision_only",
    runClassification: "provision_only",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: "succeeded",
    admittedContext,
    ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
    ...(provisionerPlan ? { provisionerPlan } : {}),
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
  });
  return { record, recordPath: await writeS3StaticDeployRecord(opts.recordsRoot, record) };
}
