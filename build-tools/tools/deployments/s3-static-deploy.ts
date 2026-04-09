#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { S3StaticDeployment } from "./contract.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { prepareS3StaticPublisherConfig } from "./s3-static-config.ts";
import { publishS3StaticWebapp } from "./s3-static-publisher.ts";
import {
  createS3StaticDeployRecord,
  createS3StaticDeployRunId,
  writeS3StaticDeployRecord,
  type S3StaticDeployRecord,
} from "./s3-static-records.ts";
import { smokeS3StaticWebapp } from "./s3-static-smoke.ts";
import { writeS3StaticProvisionerPlan } from "./s3-static-provisioner-plan.ts";
import { resolveInitialS3StaticAdmittedContext } from "./s3-static-admission.ts";
import {
  admitStaticWebappArtifact,
  requireAdmittedStaticWebappArtifactPath,
} from "./static-webapp-artifacts.ts";

export async function submitS3StaticDeploy(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactDir: string;
  recordsRoot: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: S3StaticDeployRecord; recordPath: string }> {
  const deployRunId = createS3StaticDeployRunId();
  const artifact = await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir: path.resolve(opts.artifactDir),
  });
  const admittedContext = await resolveInitialS3StaticAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: artifact.identity,
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
    operationKind: "deploy",
    admittedContext,
    artifactLineageId: artifact.identity,
    evidence: {
      ...(opts.admissionEvidence || {}),
      ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
    },
  });
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  let providerConfigFingerprint = "";
  try {
    const artifactPath = await requireAdmittedStaticWebappArtifactPath(artifact);
    const preparedConfig = await prepareS3StaticPublisherConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      outputPath: path.join(opts.recordsRoot, "provider-config", `${deployRunId}.s3.json`),
    });
    providerConfigFingerprint = preparedConfig.fingerprint;
    const published = await publishS3StaticWebapp({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactDir: artifactPath,
      renderedConfigPath: preparedConfig.renderedConfigPath,
    });
    const smoke = await smokeS3StaticWebapp({
      deployment: opts.deployment,
      indexPath: path.join(artifactPath, "index.html"),
      connectOverride: opts.smokeConnectOverride,
    });
    const record = createS3StaticDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      artifact: artifact,
      admittedContext,
      ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
      ...(provisionerPlan ? { provisionerPlan } : {}),
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      publicUrl: smoke.publicUrl,
      ...(published.providerReleaseId ? { providerReleaseId: published.providerReleaseId } : {}),
    });
    return { record, recordPath: await writeS3StaticDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const failedStep =
      error instanceof Error && error.message.includes("smoke") ? "smoke" : "publish";
    const record = createS3StaticDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      artifact: artifact,
      admittedContext,
      ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
      ...(provisionerPlan ? { provisionerPlan } : {}),
      deploymentMetadataFingerprint,
      ...(providerConfigFingerprint ? { providerConfigFingerprint } : {}),
      failedStep,
      error: error instanceof Error ? error.message : String(error),
    });
    const recordPath = await writeS3StaticDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}
