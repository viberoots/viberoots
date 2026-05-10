#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import {
  resolveCrossDeploymentPromotionSelection,
  resolveCrossDeploymentPromotionSourceSelection,
  resolveDeploymentPromotionSource,
} from "./deployment-promotion";
import {
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane";
import {
  requireNixosSharedHostReplayComponentState,
  resolveNixosSharedHostReplaySelection,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";

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

export type ResolvedPublishOnlySubmission = {
  operationKind: "promotion" | "retry" | "rollback";
  deployment: NixosSharedHostDeployment;
  artifact?: any;
  componentArtifacts?: any[];
  publishBehavior: "publish-only";
  parentRunId: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source: {
    record: any;
    replaySnapshot: any;
    replaySnapshotPath: string;
  };
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
  const resolved = value || String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!resolved) {
    throw new Error(
      "shared replay source lookup requires backendDatabaseUrl or VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  return resolved;
}

export async function submitNixosSharedHostPublishOnlyRun(opts: PublishOnlyRunOpts) {
  const resolved = await resolveNixosSharedHostPublishOnlySubmission(opts);
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: resolved.operationKind,
    deployment: resolved.deployment,
    ...(resolved.artifact ? { artifact: resolved.artifact } : {}),
    ...(resolved.componentArtifacts ? { componentArtifacts: resolved.componentArtifacts } : {}),
    publishBehavior: resolved.publishBehavior,
    parentRunId: resolved.parentRunId,
    ...(resolved.releaseLineageId ? { releaseLineageId: resolved.releaseLineageId } : {}),
    ...(resolved.artifactLineageId ? { artifactLineageId: resolved.artifactLineageId } : {}),
    source: resolved.source,
    paths: opts.paths,
    ...sharedSubmitOpts(opts),
  });
}

export async function resolveNixosSharedHostPublishOnlySubmission(
  opts: PublishOnlyRunOpts,
): Promise<ResolvedPublishOnlySubmission> {
  if (opts.rollback) {
    const replay = await resolveNixosSharedHostReplaySelection({
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      backendDatabaseUrl: requireBackendDatabaseUrl(opts.backendDatabaseUrl),
      sourceRunId: opts.sourceRunId,
      rollback: true,
    });
    return {
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
    };
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
    return {
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
    };
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
    return {
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
    };
  }
  const promotion = await resolveCrossDeploymentPromotionSelection({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  return {
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
  };
}
