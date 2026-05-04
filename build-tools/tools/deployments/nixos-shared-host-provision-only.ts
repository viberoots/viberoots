#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane";
import { resolveNixosSharedHostReplaySelection } from "./nixos-shared-host-replay";

type ProvisionOnlyRunOpts = {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  sourceRunId: string;
  backendDatabaseUrl?: string;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
};

export type ResolvedProvisionOnlySubmission = {
  operationKind: "provision_only";
  deployment: NixosSharedHostDeployment;
  publishBehavior: "provision-only";
  artifact?: any;
  componentArtifacts?: any[];
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source?: {
    record: any;
    replaySnapshot: any;
    replaySnapshotPath: string;
  };
};

function sharedSubmitOpts(opts: ProvisionOnlyRunOpts) {
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

export async function submitNixosSharedHostProvisionOnlyRun(opts: ProvisionOnlyRunOpts) {
  const resolved = await resolveNixosSharedHostProvisionOnlySubmission(opts);
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: resolved.operationKind,
    deployment: resolved.deployment,
    ...(resolved.artifact ? { artifact: resolved.artifact } : {}),
    ...(resolved.componentArtifacts ? { componentArtifacts: resolved.componentArtifacts } : {}),
    publishBehavior: resolved.publishBehavior,
    ...(resolved.parentRunId ? { parentRunId: resolved.parentRunId } : {}),
    ...(resolved.releaseLineageId ? { releaseLineageId: resolved.releaseLineageId } : {}),
    ...(resolved.artifactLineageId ? { artifactLineageId: resolved.artifactLineageId } : {}),
    ...(resolved.source ? { source: resolved.source } : {}),
    paths: opts.paths,
    ...sharedSubmitOpts(opts),
  });
}

export async function resolveNixosSharedHostProvisionOnlySubmission(
  opts: ProvisionOnlyRunOpts,
): Promise<ResolvedProvisionOnlySubmission> {
  if (!opts.sourceRunId) {
    return {
      operationKind: "provision_only",
      deployment: opts.deployment,
      publishBehavior: "provision-only",
    };
  }
  const replay = await resolveNixosSharedHostReplaySelection({
    deployment: opts.deployment,
    recordsRoot: opts.paths.recordsRoot,
    backendDatabaseUrl: requireBackendDatabaseUrl(opts.backendDatabaseUrl),
    sourceRunId: opts.sourceRunId,
    rollback: false,
  });
  return {
    operationKind: "provision_only",
    deployment: replay.deployment,
    ...(replay.artifact ? { artifact: replay.artifact } : {}),
    ...(replay.componentArtifacts ? { componentArtifacts: replay.componentArtifacts } : {}),
    publishBehavior: "provision-only",
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
