#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import { syncBackendDeployRecordsFromRunMirrors } from "./nixos-shared-host-control-plane-backend.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { submitNixosSharedHostPublishOnlyRun } from "./nixos-shared-host-publish-only.ts";
import { submitNixosSharedHostProvisionOnlyRun } from "./nixos-shared-host-provision-only.ts";

type SharedSourceFrontDoorOpts = {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  sourceRunId: string;
  artifactDirFlag: string;
  backendDatabaseUrl?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
};

async function prepareDirectSharedHostSourceBackend(opts: {
  recordsRoot: string;
  backendDatabaseUrl?: string;
}) {
  if (!opts.backendDatabaseUrl) {
    throw new Error(
      "shared replay source lookup requires --control-plane-database-url or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  await syncBackendDeployRecordsFromRunMirrors({
    recordsRoot: opts.recordsRoot,
    databaseUrl: opts.backendDatabaseUrl,
  });
  return opts.backendDatabaseUrl;
}

export async function runNixosSharedHostProvisionOnlyFrontDoor(opts: SharedSourceFrontDoorOpts) {
  if (opts.artifactDirFlag) {
    throw new Error(
      "nixos-shared-host --provision-only must not use --artifact-dir; default metadata-only runs do not load artifacts, and immutable reuse must be selected with --source-run-id",
    );
  }
  const backendDatabaseUrl = opts.sourceRunId
    ? await prepareDirectSharedHostSourceBackend({
        recordsRoot: opts.paths.recordsRoot,
        backendDatabaseUrl: opts.backendDatabaseUrl,
      })
    : undefined;
  return await submitNixosSharedHostProvisionOnlyRun({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    paths: opts.paths,
    sourceRunId: opts.sourceRunId,
    ...(backendDatabaseUrl ? { backendDatabaseUrl } : {}),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}

export async function runNixosSharedHostPublishOnlyFrontDoor(
  opts: SharedSourceFrontDoorOpts & { rollback: boolean },
) {
  if (!opts.sourceRunId) {
    throw new Error(
      opts.rollback
        ? "shared rollback requires --source-run-id"
        : "shared --publish-only requires --source-run-id to select an admitted run",
    );
  }
  if (opts.artifactDirFlag) {
    throw new Error(
      "shared --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  const backendDatabaseUrl = await prepareDirectSharedHostSourceBackend({
    recordsRoot: opts.paths.recordsRoot,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  return await submitNixosSharedHostPublishOnlyRun({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    paths: opts.paths,
    sourceRunId: opts.sourceRunId,
    rollback: opts.rollback,
    backendDatabaseUrl,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}
