#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { providerTargetIdentityFor, type DeploymentTarget } from "../../deployments/contract";
import { writeBackendDeployRecordDoc } from "../../deployments/nixos-shared-host-control-plane-backend";

export function admittedContextFixture(deployment: DeploymentTarget) {
  return {
    source: {
      sourceRevision: "rev-source-123",
      artifactIdentity: "artifact-123",
    },
    targetEnvironment: {
      providerTargetIdentity: providerTargetIdentityFor(deployment),
    },
  };
}

export async function writeSuccessfulPrerequisiteRecord(
  tmp: string,
  backendDatabaseUrl: string,
  deploymentId: string,
  options: Partial<{ publicUrl: string; healthUrl: string }> = {},
) {
  const recordPath = path.join(
    tmp,
    ".local",
    "deployments",
    "nixos-shared-host",
    "records",
    "runs",
    `${deploymentId}-success.json`,
  );
  const record = {
    schemaVersion: "deploy-record@2026-04-04",
    deployRunId: `${deploymentId}-run`,
    deploymentId,
    finalOutcome: "succeeded",
    controlPlane: {
      submissionId: `prereq-${deploymentId}`,
    },
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
    ...(options.healthUrl ? { healthUrl: options.healthUrl } : {}),
  };
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  await writeBackendDeployRecordDoc(
    {
      recordsRoot: path.join(tmp, ".local", "deployments", "nixos-shared-host", "records"),
      databaseUrl: backendDatabaseUrl,
    },
    record,
    recordPath,
  );
}

export async function writeCloudflarePrerequisiteRecord(
  tmp: string,
  deploymentId: string,
  options: Partial<{ publicUrl: string; healthUrl: string }> = {},
) {
  const recordPath = path.join(
    tmp,
    ".local",
    "deployments",
    "cloudflare-pages",
    "records",
    "runs",
    `${deploymentId}-success.json`,
  );
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(
    recordPath,
    JSON.stringify(
      {
        schemaVersion: "deploy-record@2026-04-04",
        provider: "cloudflare-pages",
        deployRunId: `${deploymentId}-run`,
        deploymentId,
        finalOutcome: "succeeded",
        ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
        ...(options.healthUrl ? { healthUrl: options.healthUrl } : {}),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}
