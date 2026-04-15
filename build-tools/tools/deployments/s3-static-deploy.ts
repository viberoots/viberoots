#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { S3StaticDeployment } from "./contract.ts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import {
  classifySmokeRetry,
  noPublishAutoRetry,
  runWithAutomaticRetry,
} from "./deployment-retry-policy.ts";
import { prepareS3StaticPublisherConfig } from "./s3-static-config.ts";
import { publishS3StaticWebapp } from "./s3-static-publisher.ts";
import {
  createS3StaticDeployRecord,
  createS3StaticDeployRunId,
  writeS3StaticDeployRecord,
  type S3StaticDeployRecord,
} from "./s3-static-records.ts";
import { writeS3StaticReplaySnapshot } from "./s3-static-replay.ts";
import { smokeS3StaticWebapp } from "./s3-static-smoke.ts";
import { writeS3StaticProvisionerPlan } from "./s3-static-provisioner-plan.ts";
import { resolveInitialS3StaticAdmittedContext } from "./s3-static-admission.ts";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers.ts";
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
  const secretRuntime = createVaultDeploymentSecretRuntime({
    admittedContext,
  });
  let providerConfigFingerprint = "";
  let executionPolicy: DeploymentExecutionPolicyFacts | undefined;
  try {
    await secretRuntime.enterStep("publish");
    const artifactPath = await requireAdmittedStaticWebappArtifactPath(artifact);
    const preparedConfig = await prepareS3StaticPublisherConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      outputPath: path.join(opts.recordsRoot, "provider-config", `${deployRunId}.s3.json`),
    });
    providerConfigFingerprint = preparedConfig.fingerprint;
    const published = await runWithAutomaticRetry({
      step: "publish",
      run: async () =>
        await publishS3StaticWebapp({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactDir: artifactPath,
          renderedConfigPath: preparedConfig.renderedConfigPath,
        }),
      classifyError: () => noPublishAutoRetry(),
    })
      .then((result) => {
        executionPolicy = { retries: [result.audit] };
        return result.result;
      })
      .catch((error) => {
        executionPolicy = { retries: [(error as any).retryAudit] };
        throw error;
      });
    const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
    executionPolicy = {
      smokeBudget: smokeMode.budget,
      retries: [...(executionPolicy?.retries || [])],
    };
    const smoke =
      smokeMode.mode === "omitted"
        ? {
            publicUrl: opts.deployment.providerTarget.canonicalUrl,
            smokeOutcome: "omitted_by_exception" as const,
          }
        : await secretRuntime
            .enterStep("smoke")
            .then(
              async () =>
                await runWithAutomaticRetry({
                  step: "smoke",
                  totalBudgetMs: smokeMode.budget.totalBudgetMs,
                  run: async () =>
                    await smokeS3StaticWebapp({
                      deployment: opts.deployment,
                      indexPath: path.join(artifactPath, "index.html"),
                      connectOverride: opts.smokeConnectOverride,
                    }),
                  classifyError: classifySmokeRetry,
                }),
            )
            .then((result) => {
              executionPolicy = {
                smokeBudget: smokeMode.budget,
                retries: [...(executionPolicy?.retries || []), result.audit],
              };
              return { ...result.result, smokeOutcome: "passed" as const };
            })
            .catch((error) => {
              executionPolicy = {
                smokeBudget: smokeMode.budget,
                retries: [...(executionPolicy?.retries || []), (error as any).retryAudit],
              };
              if (smokeMode.mode !== "nonblocking") throw error;
              return {
                publicUrl: opts.deployment.providerTarget.canonicalUrl,
                smokeOutcome: "failed_nonblocking" as const,
                smokeError: error instanceof Error ? error.message : String(error),
              };
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
      smokeOutcome: smoke.smokeOutcome,
      ...(smokeMode.smokeException ? { smokeException: smokeMode.smokeException } : {}),
      ...(smoke.smokeError ? { smokeError: smoke.smokeError } : {}),
      ...(executionPolicy ? { executionPolicy } : {}),
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      replaySnapshotPath: await writeS3StaticReplaySnapshot({
        recordsRoot: opts.recordsRoot,
        deployRunId,
        deployment: opts.deployment,
        artifact,
        admittedContext,
        providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
      }),
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
      ...(executionPolicy ? { executionPolicy } : {}),
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
