#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  admitMobileAppArtifact,
  requireAdmittedMobileAppArtifactPath,
  type AdmittedMobileAppArtifact,
} from "./app-store-connect-artifacts";
import { resolveInitialAppStoreConnectAdmittedContext } from "./app-store-connect-admission";
import { prepareAppStoreConnectPublisherConfig } from "./app-store-connect-config";
import {
  assertHealthyAppStoreConnectRelease,
  publishAppStoreConnectMobileApp,
} from "./app-store-connect-publisher";
import {
  createAppStoreConnectDeployRecord,
  createAppStoreConnectDeployRunId,
  writeAppStoreConnectDeployRecord,
  type AppStoreConnectDeployRecord,
} from "./app-store-connect-records";
import { writeAppStoreConnectReplaySnapshot } from "./app-store-connect-replay";
import type { AppStoreConnectDeployment } from "./contract";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import {
  mergeExecutionPolicyFacts,
  publishWithFailClosedRetry,
} from "./mobile-store-deploy-shared";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers";
import { evaluateMobileStoreReleaseHealth } from "./mobile-store-secret-runtime";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";

export async function publishRecordedAppStoreConnectArtifact(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  recordsRoot: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  artifact: AdmittedMobileAppArtifact;
  admittedContext: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  sourceTrack?: string;
  providerConfigFingerprint?: string;
  providerConfigSnapshotPath: string;
}): Promise<{ record: AppStoreConnectDeployRecord; recordPath: string }> {
  const deployRunId = createAppStoreConnectDeployRunId(opts.operationKind);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const secretRuntime = createVaultDeploymentSecretRuntime({
    admittedContext: opts.admittedContext,
  });
  let executionPolicy: DeploymentExecutionPolicyFacts | undefined;
  try {
    await secretRuntime.enterStep("publish");
    const published = await publishWithFailClosedRetry(
      async () =>
        await publishAppStoreConnectMobileApp({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactPath: await requireAdmittedMobileAppArtifactPath(opts.artifact),
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
      assertHealthy: () => assertHealthyAppStoreConnectRelease(published.result),
    });
    executionPolicy = mergeExecutionPolicyFacts(executionPolicy, smoke.executionPolicy);
    const replay = await writeAppStoreConnectReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      admittedContext: opts.admittedContext as any,
      providerConfigSnapshotPath: opts.providerConfigSnapshotPath,
    });
    const record = createAppStoreConnectDeployRecord(opts.deployment, {
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
    return { record, recordPath: await writeAppStoreConnectDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const failedStep =
      error instanceof Error && error.message.includes("release_health")
        ? "release_health"
        : "publish";
    const record = createAppStoreConnectDeployRecord(opts.deployment, {
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
    const recordPath = await writeAppStoreConnectDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}

export async function submitAppStoreConnectDeploy(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  artifactPath: string;
  recordsRoot: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const artifact = await admitMobileAppArtifact({
    recordsRoot: opts.recordsRoot,
    artifactPath: path.resolve(opts.artifactPath),
  });
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(opts.admissionEvidence);
  const admittedContext = await resolveInitialAppStoreConnectAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: artifact.identity,
    ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
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
  const preparedConfig = await prepareAppStoreConnectPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(opts.recordsRoot, "provider-config", `${artifact.identity}.asc.json`),
  });
  return await publishRecordedAppStoreConnectArtifact({
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
