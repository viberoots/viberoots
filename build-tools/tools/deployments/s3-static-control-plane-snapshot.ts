#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract";
import {
  admitProviderControlPlaneSnapshot,
  type FrozenProviderSnapshotFields,
} from "./deployment-provider-frozen-snapshot";
import {
  resolveInitialS3StaticAdmittedContext,
  resolvePromotionS3StaticAdmittedContext,
  resolveSourceRunS3StaticAdmittedContext,
} from "./s3-static-admission";
import { resolveS3StaticReplaySource, type S3StaticReplaySnapshot } from "./s3-static-replay";
import {
  admitStaticWebappArtifact,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts";
import type { S3StaticControlPlaneSubmitRequest } from "./s3-static-control-plane";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";

export type S3StaticControlPlaneSnapshot = FrozenProviderSnapshotFields & {
  schemaVersion: "s3-static-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: S3StaticControlPlaneSubmitRequest["operationKind"];
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: S3StaticDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifact?: AdmittedStaticWebappArtifact;
  replaySnapshot?: S3StaticReplaySnapshot;
  sourceRecord?: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  smokeConnectOverride?: unknown;
};

export async function buildS3StaticControlPlaneSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: S3StaticControlPlaneSubmitRequest;
}): Promise<S3StaticControlPlaneSnapshot> {
  const base = baseSnapshot(opts);
  const replay =
    opts.request.operationKind === "promotion" ||
    opts.request.operationKind === "retry" ||
    opts.request.operationKind === "rollback"
      ? await resolveReplay(opts)
      : {};
  const artifact =
    opts.request.operationKind === "deploy"
      ? await admitStaticWebappArtifact({
          recordsRoot: opts.recordsRoot,
          artifactDir: String(opts.request.artifactDir || ""),
        })
      : (replay as { artifact?: AdmittedStaticWebappArtifact }).artifact;
  const admittedContext = await admittedContextFor({ ...opts, artifact, replay });
  return {
    ...base,
    ...(artifact ? { artifact } : {}),
    ...replay,
    ...(await admitProviderControlPlaneSnapshot({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind: opts.request.operationKind as any,
      admittedContext,
      sourceRecord: (replay as any).sourceRecord,
      artifactLineageId: (replay as any).artifactLineageId || artifact?.identity,
      evidence: opts.request.admissionEvidence as any,
    })),
  };
}

function baseSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: S3StaticControlPlaneSubmitRequest;
}) {
  const { request } = opts;
  return {
    schemaVersion: "s3-static-control-plane-snapshot@1" as const,
    submissionId: request.submissionId,
    submittedAt: request.submittedAt,
    operationKind: request.operationKind,
    deploymentId: request.deployment.deploymentId,
    deploymentLabel: request.deployment.label,
    providerTargetIdentity: request.deployment.providerTarget.providerTargetIdentity,
    lockScope: request.deployment.providerTarget.providerTargetIdentity,
    deployment: request.deployment,
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    ...(request.expectedSourceRevision
      ? { expectedSourceRevision: request.expectedSourceRevision }
      : {}),
    ...(request.sourceRunId ? { sourceRunId: request.sourceRunId } : {}),
    ...(request.smokeConnectOverride ? { smokeConnectOverride: request.smokeConnectOverride } : {}),
  };
}

async function resolveReplay(opts: {
  recordsRoot: string;
  request: S3StaticControlPlaneSubmitRequest;
}) {
  const source = await resolveS3StaticReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: String(opts.request.sourceRunId || ""),
  });
  return {
    artifact: source.replaySnapshot.artifact,
    replaySnapshot: source.replaySnapshot,
    sourceRecord: source.record,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
  };
}

async function admittedContextFor(opts: {
  workspaceRoot: string;
  request: S3StaticControlPlaneSubmitRequest;
  artifact?: AdmittedStaticWebappArtifact;
  replay: Record<string, any>;
}) {
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(
    opts.request.admissionEvidence,
  );
  const common = {
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.request.deployment,
    artifactIdentity:
      opts.replay.artifactLineageId ||
      opts.artifact?.identity ||
      `provision-only:${opts.request.deployment.providerTarget.providerTargetIdentity}`,
    ...(opts.request.expectedSourceRevision
      ? { expectedSourceRevision: opts.request.expectedSourceRevision }
      : {}),
    ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
  };
  if (opts.request.operationKind === "promotion") {
    return await resolvePromotionS3StaticAdmittedContext({
      ...common,
      sourceRecord: opts.replay.sourceRecord,
    });
  }
  if (opts.request.operationKind === "retry" || opts.request.operationKind === "rollback") {
    return await resolveSourceRunS3StaticAdmittedContext({
      ...common,
      sourceRecord: opts.replay.sourceRecord,
    });
  }
  return await resolveInitialS3StaticAdmittedContext(common);
}
