#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { AppStoreConnectDeployment } from "./contract";
import {
  admitMobileAppArtifact,
  type AdmittedMobileAppArtifact,
} from "./app-store-connect-artifacts";
import { prepareAppStoreConnectPublisherConfig } from "./app-store-connect-config";
import {
  resolveInitialAppStoreConnectAdmittedContext,
  resolvePromotionAppStoreConnectAdmittedContext,
  resolveSourceRunAppStoreConnectAdmittedContext,
} from "./app-store-connect-admission";
import {
  resolveAppStoreConnectReplaySource,
  type AppStoreConnectReplaySnapshot,
} from "./app-store-connect-replay";
import { resolveCrossDeploymentPromotionSelection } from "./deployment-promotion";
import {
  queueFrozenProviderSubmission,
  admitProviderControlPlaneSnapshot,
  type FrozenProviderSnapshotFields,
} from "./deployment-provider-frozen-snapshot";
import { reviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";
import { type NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { DeploymentServiceClientSelectionEvidence } from "./deployment-service-client-selection";

export const APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "app-store-connect-control-plane-submit-request@1";

export type AppStoreConnectControlPlaneSubmitRequest = {
  schemaVersion: typeof APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: AppStoreConnectDeployment;
  operationKind: "deploy" | "publish_only" | "rollback";
  artifactPath?: string;
  sourceRunId?: string;
  admissionEvidence?: unknown;
  controlPlaneSelection?: DeploymentServiceClientSelectionEvidence;
};

export type AppStoreConnectControlPlaneSnapshot = FrozenProviderSnapshotFields & {
  schemaVersion: "app-store-connect-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: AppStoreConnectDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifact: AdmittedMobileAppArtifact;
  replaySnapshot?: AppStoreConnectReplaySnapshot;
  sourceRecord?: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId: string;
  sourceTrack?: string;
  providerConfigFingerprint: string;
  providerConfigSnapshotPath: string;
};

export async function queueAppStoreConnectControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: AppStoreConnectControlPlaneSubmitRequest;
}) {
  const snapshot = await buildSnapshot({
    ...opts,
    expectedCurrentRunId: (
      await reviewedCurrentStageExpectation({
        backend: opts.backend,
        deployment: opts.request.deployment,
      })
    ).expectedCurrentRunId,
  });
  return await queueFrozenProviderSubmission({
    recordsRoot: opts.recordsRoot,
    backend: opts.backend,
    snapshot,
  });
}

async function buildSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: AppStoreConnectControlPlaneSubmitRequest;
  expectedCurrentRunId?: string | null;
}): Promise<AppStoreConnectControlPlaneSnapshot> {
  const replay = opts.request.operationKind === "deploy" ? {} : await resolveReplay(opts);
  const operationKind =
    opts.request.operationKind === "publish_only"
      ? (replay as any).operationKind
      : opts.request.operationKind;
  const artifact =
    opts.request.operationKind === "deploy"
      ? await admitMobileAppArtifact({
          recordsRoot: opts.recordsRoot,
          artifactPath: path.resolve(String(opts.request.artifactPath || "")),
        })
      : (replay as { artifact: AdmittedMobileAppArtifact }).artifact;
  const admittedContext =
    opts.request.operationKind === "deploy"
      ? await resolveInitialAppStoreConnectAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.request.deployment,
          artifactIdentity: artifact.identity,
        })
      : operationKind === "promotion"
        ? await resolvePromotionAppStoreConnectAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.request.deployment,
            artifactIdentity: artifact.identity,
            sourceRecord: (replay as any).sourceRecord,
          })
        : await resolveSourceRunAppStoreConnectAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.request.deployment,
            artifactIdentity: artifact.identity,
            sourceRecord: (replay as any).sourceRecord,
          });
  const providerConfig = await prepareAppStoreConnectPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.request.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${opts.request.submissionId}.asc.json`,
    ),
  });
  const base = {
    schemaVersion: "app-store-connect-control-plane-snapshot@1" as const,
    submissionId: opts.request.submissionId,
    submittedAt: opts.request.submittedAt,
    operationKind,
    deploymentId: opts.request.deployment.deploymentId,
    deploymentLabel: opts.request.deployment.label,
    providerTargetIdentity: opts.request.deployment.providerTarget.providerTargetIdentity,
    lockScope: opts.request.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.request.deployment,
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    artifact,
    ...replay,
    artifactLineageId: (replay as any).artifactLineageId || artifact.identity,
    providerConfigFingerprint: providerConfig.fingerprint,
    providerConfigSnapshotPath: providerConfig.renderedConfigPath,
  };
  return {
    ...base,
    ...(await admitProviderControlPlaneSnapshot({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind,
      admittedContext,
      sourceRecord: (replay as any).sourceRecord,
      artifactLineageId: base.artifactLineageId,
      evidence: opts.request.admissionEvidence as any,
      expectedCurrentRunId: opts.expectedCurrentRunId,
    })),
  };
}

async function resolveReplay(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: AppStoreConnectControlPlaneSubmitRequest;
}) {
  if (opts.request.operationKind === "publish_only") {
    const source = await resolveAppStoreConnectReplaySource({
      recordsRoot: opts.recordsRoot,
      deployRunId: String(opts.request.sourceRunId || ""),
    });
    if (source.replaySnapshot.deployment.deploymentId === opts.request.deployment.deploymentId) {
      return {
        operationKind: "retry" as const,
        artifact: source.replaySnapshot.artifact,
        sourceRecord: source.record,
        parentRunId: source.record.deployRunId,
        releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
        artifactLineageId:
          source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
        replaySnapshot: source.replaySnapshot,
        sourceTrack: source.replaySnapshot.deployment.providerTarget.track,
      };
    }
    const promotion = await resolveCrossDeploymentPromotionSelection({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.request.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId: String(opts.request.sourceRunId || ""),
    });
    return {
      operationKind: "promotion" as const,
      artifact: promotion.artifact as AdmittedMobileAppArtifact,
      sourceRecord: promotion.sourceRecord,
      parentRunId: promotion.parentRunId,
      releaseLineageId: promotion.releaseLineageId,
      artifactLineageId: promotion.artifactLineageId,
      replaySnapshot: promotion.sourceReplaySnapshot,
      sourceTrack: (promotion.sourceReplaySnapshot as any).deployment.providerTarget.track,
    };
  }
  const source = await resolveAppStoreConnectReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: String(opts.request.sourceRunId || ""),
  });
  return {
    operationKind: "rollback" as const,
    artifact: source.replaySnapshot.artifact,
    sourceRecord: source.record,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    replaySnapshot: source.replaySnapshot,
    sourceTrack: source.replaySnapshot.deployment.providerTarget.track,
  };
}
