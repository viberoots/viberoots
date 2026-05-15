#!/usr/bin/env zx-wrapper
import type { VercelDeployment } from "./contract";
import {
  admitProviderControlPlaneSnapshot,
  type FrozenProviderSnapshotFields,
} from "./deployment-provider-frozen-snapshot";
import {
  resolveInitialVercelAdmittedContext,
  resolveSourceRunVercelAdmittedContext,
} from "./vercel-admission";
import {
  admitVercelPrebuiltArtifact,
  type AdmittedVercelPrebuiltArtifact,
} from "./vercel-artifacts";
import { resolveVercelReplaySource, type VercelReplaySnapshot } from "./vercel-replay";
import type { VercelControlPlaneSubmitRequest } from "./vercel-control-plane";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";

export type VercelControlPlaneSnapshot = FrozenProviderSnapshotFields & {
  schemaVersion: "vercel-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: VercelControlPlaneSubmitRequest["operationKind"];
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: VercelDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifact?: AdmittedVercelPrebuiltArtifact;
  replaySnapshot?: VercelReplaySnapshot;
  sourceRecord?: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  smokeConnectOverride?: unknown;
};

export async function buildVercelControlPlaneSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: VercelControlPlaneSubmitRequest;
  expectedCurrentRunId?: string | null;
  objectStore?: ControlPlaneArtifactStore;
}): Promise<VercelControlPlaneSnapshot> {
  const base = baseSnapshot(opts);
  const replay = needsReplay(opts.request) ? await resolveReplay(opts) : {};
  const artifact =
    opts.request.operationKind === "deploy" || opts.request.operationKind === "preview"
      ? (replay as { artifact?: AdmittedVercelPrebuiltArtifact }).artifact ||
        (await admitVercelPrebuiltArtifact(requireVercelArtifactDir(opts.request), {
          recordsRoot: opts.recordsRoot,
          ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
          deploymentId: opts.request.deployment.deploymentId,
          submissionId: opts.request.submissionId,
        }))
      : (replay as { artifact?: AdmittedVercelPrebuiltArtifact }).artifact;
  const admittedContext = await admittedContextFor({ ...opts, replay, artifact });
  return {
    ...base,
    ...(artifact ? { artifact } : {}),
    ...replay,
    ...(await admitProviderControlPlaneSnapshot({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind:
        opts.request.operationKind === "preview_cleanup"
          ? "preview"
          : (opts.request.operationKind as any),
      admittedContext,
      sourceRecord: (replay as any).sourceRecord,
      artifactLineageId: (replay as any).artifactLineageId || artifact?.identity,
      evidence: opts.request.admissionEvidence as any,
      expectedCurrentRunId: opts.expectedCurrentRunId,
    })),
  };
}

function needsReplay(request: VercelControlPlaneSubmitRequest) {
  return (
    ["retry", "rollback", "preview_cleanup"].includes(request.operationKind) ||
    Boolean(request.sourceRunId && ["deploy", "preview"].includes(request.operationKind))
  );
}

function baseSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: VercelControlPlaneSubmitRequest;
}) {
  const { request } = opts;
  return {
    schemaVersion: "vercel-control-plane-snapshot@1" as const,
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
  request: VercelControlPlaneSubmitRequest;
}) {
  const source = await resolveVercelReplaySource({
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
  request: VercelControlPlaneSubmitRequest;
  replay: Record<string, any>;
  artifact?: AdmittedVercelPrebuiltArtifact;
}) {
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(
    opts.request.admissionEvidence,
  );
  const artifactIdentity =
    opts.replay.artifactLineageId || opts.artifact?.identity || "preview-cleanup";
  if (needsReplay(opts.request)) {
    return await resolveSourceRunVercelAdmittedContext({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.request.deployment,
      artifactIdentity,
      sourceRecord: opts.replay.sourceRecord,
      ...(opts.request.expectedSourceRevision
        ? { expectedSourceRevision: opts.request.expectedSourceRevision }
        : {}),
      ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
    });
  }
  return await resolveInitialVercelAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.request.deployment,
    artifactIdentity,
    ...(opts.request.sourceRunId ? { sourceRunId: opts.request.sourceRunId } : {}),
    ...(opts.request.expectedSourceRevision
      ? { expectedSourceRevision: opts.request.expectedSourceRevision }
      : {}),
    ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
  });
}

function requireVercelArtifactDir(request: VercelControlPlaneSubmitRequest): string {
  const artifactDir = String(request.artifactDir || "").trim();
  if (artifactDir) return artifactDir;
  throw new Error(
    "protected/shared vercel deploy requires an admitted artifact input or --source-run-id; --artifact-dir is rejected by the public CLI",
  );
}
