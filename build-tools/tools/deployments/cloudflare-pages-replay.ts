#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";
import { requireAdmittedStaticWebappArtifactPath } from "./static-webapp-artifacts.ts";
import {
  deployRecordPathFor,
  readCloudflarePagesDeployRecord,
  type CloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";

export const CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA = "cloudflare-pages-replay-snapshot@1";

export type CloudflarePagesReplaySnapshot = {
  schemaVersion: typeof CLOUDFLARE_PAGES_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
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
  return JSON.parse(
    await fsp.readFile(replaySnapshotPath, "utf8"),
  ) as CloudflarePagesReplaySnapshot;
}

function requireReplaySnapshotPath(record: CloudflarePagesDeployRecord): string {
  if (typeof record.replaySnapshotPath === "string" && record.replaySnapshotPath.trim()) {
    return record.replaySnapshotPath;
  }
  throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
}

export async function resolveCloudflarePagesReplaySource(opts: {
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
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
  const recordPath = opts.recordPath
    ? path.resolve(opts.recordPath)
    : deployRecordPathFor(String(opts.recordsRoot || ""), String(opts.deployRunId || ""));
  const record = await readCloudflarePagesDeployRecord(recordPath);
  const replaySnapshotPath = requireReplaySnapshotPath(record);
  const replaySnapshot = await readCloudflarePagesReplaySnapshot(replaySnapshotPath);
  await assertProtectedSharedReplayUsable({
    protectionClass: replaySnapshot.deployment.protectionClass as
      | "shared_nonprod"
      | "production_facing",
    deployRunId: record.deployRunId,
    recordPath,
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
