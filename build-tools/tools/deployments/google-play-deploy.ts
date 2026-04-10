#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  admitGooglePlayArtifact,
  requireAdmittedGooglePlayArtifactPath,
  type AdmittedGooglePlayArtifact,
} from "./google-play-artifacts.ts";
import {
  resolveInitialGooglePlayAdmittedContext,
  resolvePromotionGooglePlayAdmittedContext,
  resolveSourceRunGooglePlayAdmittedContext,
} from "./google-play-admission.ts";
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
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";

type SourceRecordLike = { deployRunId: string; deploymentId: string; admittedContext?: any };

async function publishRecordedArtifact(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  recordsRoot: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  artifact: AdmittedGooglePlayArtifact;
  admittedContext:
    | Awaited<ReturnType<typeof resolveInitialGooglePlayAdmittedContext>>
    | Awaited<ReturnType<typeof resolvePromotionGooglePlayAdmittedContext>>;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  sourceTrack?: string;
  providerConfigFingerprint?: string;
  providerConfigSnapshotPath: string;
}): Promise<{ record: GooglePlayDeployRecord; recordPath: string }> {
  const deployRunId = createGooglePlayDeployRunId(opts.operationKind);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  try {
    const published = await publishGooglePlayMobileApp({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactPath: await requireAdmittedGooglePlayArtifactPath(opts.artifact),
      operationKind: opts.operationKind,
      ...(opts.sourceTrack ? { sourceTrack: opts.sourceTrack } : {}),
    });
    assertHealthyGooglePlayRelease(published);
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
      storeSubmissionId: published.storeSubmissionId,
      providerReleaseId: published.providerReleaseId,
      trackState: published.trackState,
      rolloutState: published.rolloutState,
      releaseHealth: published.releaseHealth,
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

export async function submitGooglePlayExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  artifact: AdmittedGooglePlayArtifact;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceTrack?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const admittedContext =
    opts.operationKind === "promotion"
      ? await resolvePromotionGooglePlayAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        })
      : await resolveSourceRunGooglePlayAdmittedContext({
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
  const preparedConfig = await prepareGooglePlayPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${opts.parentRunId}.${opts.operationKind}.google-play.json`,
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
