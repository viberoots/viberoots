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
  options: Partial<{
    publicUrl: string;
    healthUrl: string;
    sourceRevision: string;
    artifactIdentity: string;
    providerTargetIdentity: string;
    lanePolicyRef: string;
    foundationPrerequisiteId: string;
    foundationMigration: boolean;
    compatibilityException: {
      reviewedBy: string;
      reason: string;
      expiresAt: string;
    };
  }> = {},
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
    artifact: { identity: options.artifactIdentity || "artifact-123" },
    providerTargetIdentity: options.providerTargetIdentity,
    ...(options.foundationMigration
      ? {
          foundationMigrationOutcome: {
            status: "succeeded",
            sourceRevision: options.sourceRevision || "rev-source-123",
            bundleIdentity: "migration-bundle:test",
          },
        }
      : {}),
    admittedContext: {
      lanePolicyRef: options.lanePolicyRef,
      ...(options.compatibilityException
        ? { phase0CompatibilityException: options.compatibilityException }
        : {}),
      source: {
        sourceRevision: options.sourceRevision || "rev-source-123",
        artifactIdentity: options.artifactIdentity || "artifact-123",
      },
      targetEnvironment: { providerTargetIdentity: options.providerTargetIdentity },
      policyEvaluation: {
        prerequisites: options.foundationPrerequisiteId
          ? [{ deploymentId: options.foundationPrerequisiteId, mode: "health_gated" }]
          : [],
      },
    },
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

export async function writeProviderPrerequisiteRecord(
  tmp: string,
  provider: string,
  deploymentId: string,
  options: Partial<{
    publicUrl: string;
    healthUrl: string;
    sourceRevision: string;
    artifactIdentity: string;
    providerTargetIdentity: string;
    lanePolicyRef: string;
    foundationPrerequisiteId: string;
    foundationMigration: boolean;
    compatibilityException: {
      reviewedBy: string;
      reason: string;
      expiresAt: string;
    };
  }> = {},
) {
  const recordPath = path.join(
    tmp,
    ".local",
    "deployments",
    provider,
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
        provider,
        deployRunId: `${deploymentId}-run`,
        deploymentId,
        finalOutcome: "succeeded",
        artifact: { identity: options.artifactIdentity || "artifact-123" },
        providerTargetIdentity: options.providerTargetIdentity,
        ...(options.foundationMigration
          ? {
              foundationMigrationOutcome: {
                status: "succeeded",
                sourceRevision: options.sourceRevision || "rev-source-123",
                bundleIdentity: "migration-bundle:test",
              },
            }
          : {}),
        admittedContext: {
          lanePolicyRef: options.lanePolicyRef,
          ...(options.compatibilityException
            ? { phase0CompatibilityException: options.compatibilityException }
            : {}),
          source: {
            sourceRevision: options.sourceRevision || "rev-source-123",
            artifactIdentity: options.artifactIdentity || "artifact-123",
          },
          targetEnvironment: { providerTargetIdentity: options.providerTargetIdentity },
          policyEvaluation: {
            prerequisites: options.foundationPrerequisiteId
              ? [{ deploymentId: options.foundationPrerequisiteId, mode: "health_gated" }]
              : [],
          },
        },
        ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
        ...(options.healthUrl ? { healthUrl: options.healthUrl } : {}),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function writeCloudflarePrerequisiteRecord(
  tmp: string,
  deploymentId: string,
  options: Parameters<typeof writeProviderPrerequisiteRecord>[3] = {},
) {
  await writeProviderPrerequisiteRecord(tmp, "cloudflare-pages", deploymentId, options);
}

export async function writeDeploymentPrerequisiteRecord(
  tmp: string,
  deployment: DeploymentTarget,
  provider: string,
  options: Parameters<typeof writeProviderPrerequisiteRecord>[3] = {},
) {
  await writeProviderPrerequisiteRecord(tmp, provider, deployment.deploymentId, {
    sourceRevision: "rev-source-123",
    lanePolicyRef: deployment.lanePolicyRef,
    artifactIdentity: `${deployment.deploymentId}:artifact`,
    providerTargetIdentity: providerTargetIdentityFor(deployment),
    ...options,
  });
}
