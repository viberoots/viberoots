#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import type { CloudflarePagesDeployment } from "./contract";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention";
import {
  cloudflarePagesRunnerIdentities,
  runnerIdentityCompatibilityErrors,
  type DeploymentRunnerIdentities,
} from "./deployment-runner-identities";
import {
  readBackendDeployRecordEnvelopeByDeployRunId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";
import { requireAdmittedStaticWebappArtifactPath } from "./static-webapp-artifacts";
import {
  deployRecordPathFor,
  readCloudflarePagesDeployRecord,
  type CloudflarePagesDeployRecord,
} from "./cloudflare-pages-records";

export const CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA = "cloudflare-pages-replay-snapshot@2";

export type CloudflarePagesReplaySnapshot = {
  schemaVersion: typeof CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  runnerIdentities: DeploymentRunnerIdentities;
  artifact: AdmittedStaticWebappArtifact;
  admittedContext: CloudflarePagesAdmittedContext;
  deployment: CloudflarePagesDeployment;
  providerConfigSnapshotPath: string;
  controlPlaneExecutionSnapshotPath?: string;
};

function replayBundleDir(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId);
}

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(replayBundleDir(recordsRoot, deployRunId), "snapshot.json");
}

async function writeSnapshotDocument(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeCloudflarePagesReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: CloudflarePagesDeployment;
  artifact: AdmittedStaticWebappArtifact;
  admittedContext: CloudflarePagesAdmittedContext;
  providerConfigSnapshotPath: string;
  controlPlaneExecutionSnapshotPath?: string;
}): Promise<{
  replaySnapshotPath: string;
  deploymentMetadataFingerprint: string;
}> {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const snapshot: CloudflarePagesReplaySnapshot = {
    schemaVersion: CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deploymentMetadataFingerprint,
    runnerIdentities: cloudflarePagesRunnerIdentities(opts.deployment),
    artifact: opts.artifact,
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    providerConfigSnapshotPath: path.resolve(opts.providerConfigSnapshotPath),
    ...(opts.controlPlaneExecutionSnapshotPath
      ? {
          controlPlaneExecutionSnapshotPath: path.resolve(opts.controlPlaneExecutionSnapshotPath),
        }
      : {}),
  };
  await writeSnapshotDocument(replaySnapshotPath, snapshot);
  return { replaySnapshotPath, deploymentMetadataFingerprint };
}

export async function readCloudflarePagesReplaySnapshot(
  replaySnapshotPath: string,
): Promise<CloudflarePagesReplaySnapshot> {
  return await readVersionedJson(replaySnapshotPath, {
    kind: "cloudflare-pages replay snapshot",
    currentSchemaVersion: CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA,
    migrations: {
      "cloudflare-pages-replay-snapshot@1": (raw) =>
        ({
          ...raw,
          schemaVersion: CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA,
          runnerIdentities:
            typeof raw.runnerIdentities === "object" && raw.runnerIdentities
              ? raw.runnerIdentities
              : cloudflarePagesRunnerIdentities(raw.deployment as CloudflarePagesDeployment),
        }) as CloudflarePagesReplaySnapshot,
    },
    validateCurrent: (raw): raw is CloudflarePagesReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}

function requireReplaySnapshotPath(record: CloudflarePagesDeployRecord): string {
  if (typeof record.replaySnapshotPath === "string" && record.replaySnapshotPath.trim()) {
    return record.replaySnapshotPath;
  }
  throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
}

type ReplayRecordSource = {
  record: CloudflarePagesDeployRecord;
  recordPath: string;
  recordUpdatedAt?: string;
  requireRecordPathInBundle?: false;
};

async function readLocalReplayRecord(recordPath: string): Promise<ReplayRecordSource> {
  return {
    record: await readCloudflarePagesDeployRecord(recordPath),
    recordPath,
  };
}

async function readBackendReplayRecord(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  deployRunId: string;
}): Promise<ReplayRecordSource | null> {
  const backend: NixosSharedHostControlPlaneBackendTarget = {
    recordsRoot: path.resolve(opts.recordsRoot),
    databaseUrl: opts.backendDatabaseUrl,
  };
  const envelope = await readBackendDeployRecordEnvelopeByDeployRunId(backend, opts.deployRunId);
  if (!envelope) return null;
  const record = envelope.record as CloudflarePagesDeployRecord;
  if (record.provider !== "cloudflare-pages") return null;
  return {
    record,
    recordPath: envelope.recordPath,
    recordUpdatedAt: envelope.updatedAt,
    requireRecordPathInBundle: false,
  };
}

export async function resolveCloudflarePagesReplaySource(opts: {
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
  backendDatabaseUrl?: string;
}): Promise<{
  record: CloudflarePagesDeployRecord;
  recordPath: string;
  replaySnapshot: CloudflarePagesReplaySnapshot;
  artifactDir: string;
}> {
  if (!opts.recordPath && (!opts.recordsRoot || !opts.deployRunId)) {
    throw new Error(
      "resolve replay source requires --record-path or --records-root plus --deploy-run-id",
    );
  }
  const resolvedRecord = opts.recordPath
    ? await readLocalReplayRecord(path.resolve(opts.recordPath))
    : await (async () => {
        const localRecordPath = deployRecordPathFor(
          String(opts.recordsRoot || ""),
          String(opts.deployRunId || ""),
        );
        try {
          return await readLocalReplayRecord(localRecordPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        }
        if (opts.recordsRoot && opts.deployRunId && opts.backendDatabaseUrl) {
          const backendRecord = await readBackendReplayRecord({
            recordsRoot: opts.recordsRoot,
            backendDatabaseUrl: opts.backendDatabaseUrl,
            deployRunId: opts.deployRunId,
          });
          if (backendRecord) return backendRecord;
        }
        return await readLocalReplayRecord(localRecordPath);
      })();
  const { record, recordPath } = resolvedRecord;
  const replaySnapshotPath = requireReplaySnapshotPath(record);
  const replaySnapshot = await readCloudflarePagesReplaySnapshot(replaySnapshotPath);
  const expected = cloudflarePagesRunnerIdentities(replaySnapshot.deployment);
  const compatibilityErrors = [
    ...runnerIdentityCompatibilityErrors(expected, record.runnerIdentities),
    ...runnerIdentityCompatibilityErrors(expected, replaySnapshot.runnerIdentities),
  ];
  if (compatibilityErrors.length > 0) {
    throw new Error(
      `replay runner compatibility failed for ${record.deployRunId}\n${compatibilityErrors.join("\n")}`,
    );
  }
  await assertProtectedSharedReplayUsable({
    protectionClass: replaySnapshot.deployment.protectionClass as
      | "shared_nonprod"
      | "production_facing",
    deployRunId: record.deployRunId,
    recordPath,
    ...(resolvedRecord.recordUpdatedAt ? { recordUpdatedAt: resolvedRecord.recordUpdatedAt } : {}),
    ...(resolvedRecord.requireRecordPathInBundle === false
      ? { requireRecordPathInBundle: false }
      : {}),
    replaySnapshotPath,
    replayCreatedAt: replaySnapshot.createdAt,
    artifacts: [replaySnapshot.artifact],
    replayBundlePaths: [
      replaySnapshot.providerConfigSnapshotPath,
      replaySnapshot.controlPlaneExecutionSnapshotPath || "",
    ],
    evidence: replaySnapshot.admittedContext.policyEvaluation,
  });
  const artifactDir = await requireAdmittedStaticWebappArtifactPath(replaySnapshot.artifact);
  return { record, recordPath, replaySnapshot, artifactDir };
}
