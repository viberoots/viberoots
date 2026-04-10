#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { GooglePlayAdmittedContext } from "./google-play-admission.ts";
import type { AdmittedGooglePlayArtifact } from "./google-play-artifacts.ts";
import { requireAdmittedGooglePlayArtifactPath } from "./google-play-artifacts.ts";
import type { GooglePlayDeployment } from "./contract.ts";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import {
  deployRecordPathFor,
  readGooglePlayDeployRecord,
  type GooglePlayDeployRecord,
} from "./google-play-records.ts";

export const GOOGLE_PLAY_REPLAY_SNAPSHOT_SCHEMA = "google-play-replay-snapshot@1";

export type GooglePlayReplaySnapshot = {
  schemaVersion: typeof GOOGLE_PLAY_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  artifact: AdmittedGooglePlayArtifact;
  admittedContext: GooglePlayAdmittedContext;
  deployment: GooglePlayDeployment;
  providerConfigSnapshotPath: string;
};

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId, "snapshot.json");
}

export async function writeGooglePlayReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: GooglePlayDeployment;
  artifact: AdmittedGooglePlayArtifact;
  admittedContext: GooglePlayAdmittedContext;
  providerConfigSnapshotPath: string;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const snapshot: GooglePlayReplaySnapshot = {
    schemaVersion: GOOGLE_PLAY_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
    artifact: opts.artifact,
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    providerConfigSnapshotPath: path.resolve(opts.providerConfigSnapshotPath),
  };
  await fsp.mkdir(path.dirname(replaySnapshotPath), { recursive: true });
  await fsp.writeFile(replaySnapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return {
    replaySnapshotPath,
    deploymentMetadataFingerprint: snapshot.deploymentMetadataFingerprint,
  };
}

export async function resolveGooglePlayReplaySource(opts: {
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
}): Promise<{
  record: GooglePlayDeployRecord;
  recordPath: string;
  replaySnapshot: GooglePlayReplaySnapshot;
  artifactPath: string;
}> {
  const recordPath = opts.recordPath
    ? path.resolve(opts.recordPath)
    : deployRecordPathFor(String(opts.recordsRoot || ""), String(opts.deployRunId || ""));
  const record = await readGooglePlayDeployRecord(recordPath);
  if (!record.replaySnapshotPath) {
    throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
  }
  const replaySnapshot = JSON.parse(
    await fsp.readFile(record.replaySnapshotPath, "utf8"),
  ) as GooglePlayReplaySnapshot;
  await assertProtectedSharedReplayUsable({
    protectionClass: replaySnapshot.deployment.protectionClass as
      | "shared_nonprod"
      | "production_facing",
    deployRunId: record.deployRunId,
    recordPath,
    replaySnapshotPath: record.replaySnapshotPath,
    replayCreatedAt: replaySnapshot.createdAt,
    artifacts: [replaySnapshot.artifact],
    replayBundlePaths: [replaySnapshot.providerConfigSnapshotPath],
    evidence: replaySnapshot.admittedContext.policyEvaluation,
  });
  return {
    record,
    recordPath,
    replaySnapshot,
    artifactPath: await requireAdmittedGooglePlayArtifactPath(replaySnapshot.artifact),
  };
}
