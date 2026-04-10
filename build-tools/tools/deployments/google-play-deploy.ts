#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  admitGooglePlayArtifact,
  requireAdmittedGooglePlayArtifactPath,
  type AdmittedGooglePlayArtifact,
} from "./google-play-artifacts.ts";
import { resolveInitialGooglePlayAdmittedContext } from "./google-play-admission.ts";
import { prepareGooglePlayPublisherConfig } from "./google-play-config.ts";
import {
  assertHealthyGooglePlayRelease,
  publishGooglePlayMobileApp,
} from "./google-play-publisher.ts";
import {
  createGooglePlayDeployRecord,
  createGooglePlayDeployRunId,
  writeGooglePlayDeployRecord,
  type GooglePlayDeployRecord,
} from "./google-play-records.ts";
import { writeGooglePlayReplaySnapshot } from "./google-play-replay.ts";
import type { GooglePlayDeployment } from "./contract.ts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import {
  mergeExecutionPolicyFacts,
  publishWithFailClosedRetry,
} from "./mobile-store-deploy-shared.ts";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers.ts";
import { evaluateMobileStoreReleaseHealth } from "./mobile-store-secret-runtime.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";

export async function publishRecordedGooglePlayArtifact(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  recordsRoot: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  artifact: AdmittedGooglePlayArtifact;
  admittedContext: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  sourceTrack?: string;
  providerConfigFingerprint?: string;
  providerConfigSnapshotPath: string;
}): Promise<{ record: GooglePlayDeployRecord; recordPath: string }> {
  const deployRunId = createGooglePlayDeployRunId(opts.operationKind);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const secretRuntime = createVaultDeploymentSecretRuntime({
    admittedContext: opts.admittedContext,
  });
  let executionPolicy: DeploymentExecutionPolicyFacts | undefined;
  try {
    await secretRuntime.enterStep("publish");
    const published = await publishWithFailClosedRetry(
      async () =>
        await publishGooglePlayMobileApp({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactPath: await requireAdmittedGooglePlayArtifactPath(opts.artifact),
          operationKind: opts.operationKind,
          ...(opts.sourceTrack ? { sourceTrack: opts.sourceTrack } : {}),
        }),
    ).catch((error) => {
      executionPolicy = (error as any).executionPolicy;
      throw error;
    });
    executionPolicy = published.executionPolicy;
    const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
    const smoke = await evaluateMobileStoreReleaseHealth({
      secretRuntime,
      smokeMode: { ...smokeMode, budget: smokeMode.budget },
      assertHealthy: () => assertHealthyGooglePlayRelease(published.result),
    });
    executionPolicy = mergeExecutionPolicyFacts(executionPolicy, smoke.executionPolicy);
    const replay = await writeGooglePlayReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      admittedContext: opts.admittedContext as any,
      providerConfigSnapshotPath: opts.providerConfigSnapshotPath,
    });
    const record = createGooglePlayDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      publishMode: opts.operationKind === "deploy" ? "normal" : "publish-only",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      artifact: opts.artifact,
      admittedContext: opts.admittedContext as any,
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
      deploymentMetadataFingerprint,
      ...(opts.providerConfigFingerprint
        ? { providerConfigFingerprint: opts.providerConfigFingerprint }
        : {}),
      replaySnapshotPath: replay.replaySnapshotPath,
      storeSubmissionId: published.result.storeSubmissionId,
      providerReleaseId: published.result.providerReleaseId,
      trackState: published.result.trackState,
      rolloutState: published.result.rolloutState,
      releaseHealth: published.result.releaseHealth,
      smokeOutcome: smoke.smokeOutcome,
      ...(smokeMode.smokeException ? { smokeException: smokeMode.smokeException } : {}),
      ...(smoke.smokeError ? { smokeError: smoke.smokeError } : {}),
      ...(executionPolicy ? { executionPolicy } : {}),
    });
    return { record, recordPath: await writeGooglePlayDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const failedStep =
      error instanceof Error && error.message.includes("release_health")
        ? "release_health"
        : "publish";
    const record = createGooglePlayDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      publishMode: opts.operationKind === "deploy" ? "normal" : "publish-only",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: failedStep === "publish" ? "publish_failed" : "smoke_failed_after_publish",
      artifact: opts.artifact,
      admittedContext: opts.admittedContext as any,
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
      deploymentMetadataFingerprint,
      ...(opts.providerConfigFingerprint
        ? { providerConfigFingerprint: opts.providerConfigFingerprint }
        : {}),
      ...(executionPolicy ? { executionPolicy } : {}),
      failedStep,
      error: error instanceof Error ? error.message : String(error),
    });
    const recordPath = await writeGooglePlayDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}

export async function submitGooglePlayDeploy(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactPath: string;
  recordsRoot: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const artifact = await admitGooglePlayArtifact({
    recordsRoot: opts.recordsRoot,
    artifactPath: path.resolve(opts.artifactPath),
  });
  const admittedContext = await resolveInitialGooglePlayAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: artifact.identity,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: "deploy",
    admittedContext,
    artifactLineageId: artifact.identity,
    evidence: opts.admissionEvidence,
  });
  const preparedConfig = await prepareGooglePlayPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${artifact.identity}.google-play.json`,
    ),
  });
  return await publishRecordedGooglePlayArtifact({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    operationKind: "deploy",
    artifact,
    admittedContext,
    providerConfigFingerprint: preparedConfig.fingerprint,
    providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
  });
}
