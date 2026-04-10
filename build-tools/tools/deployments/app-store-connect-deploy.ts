#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  admitMobileAppArtifact,
  requireAdmittedMobileAppArtifactPath,
  type AdmittedMobileAppArtifact,
} from "./app-store-connect-artifacts.ts";
import {
  resolveInitialAppStoreConnectAdmittedContext,
  resolvePromotionAppStoreConnectAdmittedContext,
  resolveSourceRunAppStoreConnectAdmittedContext,
} from "./app-store-connect-admission.ts";
import { prepareAppStoreConnectPublisherConfig } from "./app-store-connect-config.ts";
import {
  assertHealthyAppStoreConnectRelease,
  publishAppStoreConnectMobileApp,
} from "./app-store-connect-publisher.ts";
import {
  createAppStoreConnectDeployRecord,
  createAppStoreConnectDeployRunId,
  writeAppStoreConnectDeployRecord,
  type AppStoreConnectDeployRecord,
} from "./app-store-connect-records.ts";
import { writeAppStoreConnectReplaySnapshot } from "./app-store-connect-replay.ts";
import type { AppStoreConnectDeployment } from "./contract.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";

type SourceRecordLike = {
  deployRunId: string;
  deploymentId: string;
  admittedContext?: any;
};

async function publishRecordedArtifact(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  recordsRoot: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  artifact: AdmittedMobileAppArtifact;
  admittedContext:
    | Awaited<ReturnType<typeof resolveInitialAppStoreConnectAdmittedContext>>
    | Awaited<ReturnType<typeof resolvePromotionAppStoreConnectAdmittedContext>>;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  sourceTrack?: string;
  providerConfigFingerprint?: string;
  providerConfigSnapshotPath: string;
}): Promise<{ record: AppStoreConnectDeployRecord; recordPath: string }> {
  const deployRunId = createAppStoreConnectDeployRunId(opts.operationKind);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  try {
    const published = await publishAppStoreConnectMobileApp({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactPath: await requireAdmittedMobileAppArtifactPath(opts.artifact),
      operationKind: opts.operationKind,
      ...(opts.sourceTrack ? { sourceTrack: opts.sourceTrack } : {}),
    });
    const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
    let smokeOutcome: "passed" | "failed_nonblocking" | "omitted_by_exception" = "passed";
    let smokeError: string | undefined;
    if (smokeMode.mode === "omitted") {
      smokeOutcome = "omitted_by_exception";
    } else {
      try {
        assertHealthyAppStoreConnectRelease(published);
      } catch (error) {
        if (smokeMode.mode !== "nonblocking") throw error;
        smokeOutcome = "failed_nonblocking";
        smokeError = error instanceof Error ? error.message : String(error);
      }
    }
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
      storeSubmissionId: published.storeSubmissionId,
      providerReleaseId: published.providerReleaseId,
      trackState: published.trackState,
      rolloutState: published.rolloutState,
      releaseHealth: published.releaseHealth,
      smokeOutcome,
      ...(smokeMode.smokeException ? { smokeException: smokeMode.smokeException } : {}),
      ...(smokeError ? { smokeError } : {}),
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
  const admittedContext = await resolveInitialAppStoreConnectAdmittedContext({
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
  const preparedConfig = await prepareAppStoreConnectPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(opts.recordsRoot, "provider-config", `${artifact.identity}.asc.json`),
  });
  return await publishRecordedArtifact({
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

export async function submitAppStoreConnectExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  artifact: AdmittedMobileAppArtifact;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceTrack?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const admittedContext =
    opts.operationKind === "promotion"
      ? await resolvePromotionAppStoreConnectAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        })
      : await resolveSourceRunAppStoreConnectAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    admittedContext,
    sourceRecord: opts.sourceRecord as any,
    artifactLineageId: opts.artifactLineageId,
    evidence: opts.admissionEvidence,
  });
  const preparedConfig = await prepareAppStoreConnectPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${opts.parentRunId}.${opts.operationKind}.asc.json`,
    ),
  });
  return await publishRecordedArtifact({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    operationKind: opts.operationKind,
    artifact: opts.artifact,
    admittedContext,
    parentRunId: opts.parentRunId,
    releaseLineageId: opts.releaseLineageId,
    artifactLineageId: opts.artifactLineageId,
    sourceTrack: opts.sourceTrack,
    providerConfigFingerprint: preparedConfig.fingerprint,
    providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
  });
}
