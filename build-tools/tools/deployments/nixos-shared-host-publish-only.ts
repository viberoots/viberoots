#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  resolveCrossDeploymentPromotionSelection,
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
import { resolveNixosSharedHostReplaySelection } from "./nixos-shared-host-replay.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";

export async function submitNixosSharedHostPublishOnlyRun(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  sourceRunId: string;
  rollback: boolean;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
}) {
  if (opts.rollback) {
    const replay = await resolveNixosSharedHostReplaySelection({
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      sourceRunId: opts.sourceRunId,
      rollback: true,
    });
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: replay.operationKind,
      deployment: replay.deployment,
      ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
      ...(opts.dedupe ? { dedupe: opts.dedupe } : {}),
      ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
      artifact: replay.artifact,
      publishBehavior: "publish-only",
      parentRunId: replay.parentRunId,
      releaseLineageId: replay.releaseLineageId,
      artifactLineageId: replay.artifactLineageId,
      source: {
        record: replay.sourceRecord,
        recordPath: replay.recordPath,
        replaySnapshot: replay.sourceReplaySnapshot,
        replaySnapshotPath: replay.replaySnapshotPath,
      },
      paths: opts.paths,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  const source = await resolveDeploymentPromotionSource({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
  });
  if (source.record.deploymentId === opts.deployment.deploymentId) {
    const replay = await resolveNixosSharedHostReplaySelection({
      deployment: opts.deployment,
      recordsRoot: opts.paths.recordsRoot,
      sourceRunId: opts.sourceRunId,
      rollback: false,
    });
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: replay.operationKind,
      deployment: replay.deployment,
      ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
      ...(opts.dedupe ? { dedupe: opts.dedupe } : {}),
      ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
      artifact: replay.artifact,
      publishBehavior: "publish-only",
      parentRunId: replay.parentRunId,
      releaseLineageId: replay.releaseLineageId,
      artifactLineageId: replay.artifactLineageId,
      source: {
        record: replay.sourceRecord,
        recordPath: replay.recordPath,
        replaySnapshot: replay.sourceReplaySnapshot,
        replaySnapshotPath: replay.replaySnapshotPath,
      },
      paths: opts.paths,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  const promotion = await resolveCrossDeploymentPromotionSelection({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
  });
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: promotion.operationKind,
    deployment: promotion.deployment,
    ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
    ...(opts.dedupe ? { dedupe: opts.dedupe } : {}),
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    artifact: promotion.artifact,
    publishBehavior: "publish-only",
    parentRunId: promotion.parentRunId,
    releaseLineageId: promotion.releaseLineageId,
    artifactLineageId: promotion.artifactLineageId,
    source: {
      record: promotion.sourceRecord,
      recordPath: promotion.sourceRecordPath,
      replaySnapshotPath: promotion.sourceReplaySnapshotPath,
    },
    paths: opts.paths,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}
