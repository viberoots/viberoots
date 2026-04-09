#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { resolveNixosSharedHostReplaySelection } from "./nixos-shared-host-replay.ts";

type ProvisionOnlyRunOpts = {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  sourceRunId: string;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
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

export async function submitNixosSharedHostProvisionOnlyRun(opts: ProvisionOnlyRunOpts) {
  if (!opts.sourceRunId) {
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: "provision_only",
      deployment: opts.deployment,
      publishBehavior: "provision-only",
      paths: opts.paths,
      ...sharedSubmitOpts(opts),
    });
  }
  const replay = await resolveNixosSharedHostReplaySelection({
    deployment: opts.deployment,
    recordsRoot: opts.paths.recordsRoot,
    sourceRunId: opts.sourceRunId,
    rollback: false,
  });
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
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
      recordPath: replay.recordPath,
      replaySnapshot: replay.sourceReplaySnapshot,
      replaySnapshotPath: replay.replaySnapshotPath,
    },
    paths: opts.paths,
    ...sharedSubmitOpts(opts),
  });
}
