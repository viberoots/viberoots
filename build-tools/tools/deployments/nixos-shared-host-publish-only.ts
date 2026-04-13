#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  resolveCrossDeploymentPromotionSelection,
  resolveCrossDeploymentPromotionSourceSelection,
  resolveDeploymentPromotionSource,
} from "./deployment-promotion.ts";
import {
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import {
  requireNixosSharedHostReplayComponentState,
  resolveNixosSharedHostReplaySelection,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";

type PublishOnlyRunOpts = {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  sourceRunId: string;
  rollback: boolean;
  backendDatabaseUrl?: string;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
};

function sharedSubmitOpts(opts: PublishOnlyRunOpts) {
  return {
    ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
    ...(opts.dedupe ? { dedupe: opts.dedupe } : {}),
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}

function requireBackendDatabaseUrl(value?: string): string {
  const resolved = value || String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!resolved) {
    throw new Error(
      "shared replay source lookup requires backendDatabaseUrl or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  return resolved;
}

export async function submitNixosSharedHostPublishOnlyRun(opts: PublishOnlyRunOpts) {
  if (opts.rollback) {
    const replay = await resolveNixosSharedHostReplaySelection({
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      backendDatabaseUrl: requireBackendDatabaseUrl(opts.backendDatabaseUrl),
      sourceRunId: opts.sourceRunId,
      rollback: true,
    });
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: replay.operationKind,
      deployment: replay.deployment,
      ...(replay.artifact ? { artifact: replay.artifact } : {}),
      ...(replay.componentArtifacts
        ? {
            componentArtifacts: replay.componentArtifacts,
          }
        : {}),
      publishBehavior: "publish-only",
      parentRunId: replay.parentRunId,
      releaseLineageId: replay.releaseLineageId,
      artifactLineageId: replay.artifactLineageId,
      source: {
        record: replay.sourceRecord,
        replaySnapshot: replay.sourceReplaySnapshot,
        replaySnapshotPath: replay.replaySnapshotPath,
      },
      paths: opts.paths,
      ...sharedSubmitOpts(opts),
    });
  }
  const source = await resolveDeploymentPromotionSource({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  if (source.record.deploymentId === opts.deployment.deploymentId) {
    const replay = await resolveNixosSharedHostReplaySelection({
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      backendDatabaseUrl: requireBackendDatabaseUrl(opts.backendDatabaseUrl),
      sourceRunId: opts.sourceRunId,
      rollback: false,
    });
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: replay.operationKind,
      deployment: replay.deployment,
      ...(replay.artifact ? { artifact: replay.artifact } : {}),
      ...(replay.componentArtifacts
        ? {
            componentArtifacts: replay.componentArtifacts,
          }
        : {}),
      publishBehavior: "publish-only",
      parentRunId: replay.parentRunId,
      releaseLineageId: replay.releaseLineageId,
      artifactLineageId: replay.artifactLineageId,
      source: {
        record: replay.sourceRecord,
        replaySnapshot: replay.sourceReplaySnapshot,
        replaySnapshotPath: replay.replaySnapshotPath,
      },
      paths: opts.paths,
      ...sharedSubmitOpts(opts),
    });
  }
  if (opts.deployment.components.length > 1) {
    const promotion = await resolveCrossDeploymentPromotionSourceSelection({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      sourceRunId: opts.sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    if (promotion.sourceRecord.provider !== "nixos-shared-host") {
      throw new Error(
        "multi-component same-artifact promotion requires a nixos-shared-host source run",
      );
    }
    const sourceReplaySnapshot = promotion.sourceReplaySnapshot as NixosSharedHostReplaySnapshot;
    const replayState = requireNixosSharedHostReplayComponentState(
      opts.deployment,
      sourceReplaySnapshot,
    );
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: promotion.operationKind,
      deployment: promotion.deployment,
      componentArtifacts: replayState.componentArtifacts,
      publishBehavior: "publish-only",
      parentRunId: promotion.parentRunId,
      releaseLineageId: promotion.releaseLineageId,
      artifactLineageId:
        promotion.sourceRecord.artifactLineageId || sourceReplaySnapshot.artifactIdentity,
      source: {
        record: promotion.sourceRecord,
        replaySnapshot: sourceReplaySnapshot,
        replaySnapshotPath: promotion.sourceReplaySnapshotPath,
      },
      paths: opts.paths,
      ...sharedSubmitOpts(opts),
    });
  }
  const promotion = await resolveCrossDeploymentPromotionSelection({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: promotion.operationKind,
    deployment: promotion.deployment,
    artifact: promotion.artifact,
    publishBehavior: "publish-only",
    parentRunId: promotion.parentRunId,
    releaseLineageId: promotion.releaseLineageId,
    artifactLineageId: promotion.artifactLineageId,
    source: {
      record: promotion.sourceRecord,
      replaySnapshot: promotion.sourceReplaySnapshot,
      replaySnapshotPath: promotion.sourceReplaySnapshotPath,
    },
    paths: opts.paths,
    ...sharedSubmitOpts(opts),
  });
}
