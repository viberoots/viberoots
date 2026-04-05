#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import { requireNixosSharedHostAdmittedArtifactPath } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import {
  liveRollbackCompatibilityErrors,
  rollbackSourceEligibilityErrors,
  sameDeploymentReplayErrors,
} from "./nixos-shared-host-replay-guardrails.ts";
import {
  deployRecordPathFor,
  readNixosSharedHostDeployRecord,
  type NixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";

export const NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA = "nixos-shared-host-replay-snapshot@1";

export type NixosSharedHostReplaySnapshot = {
  schemaVersion: typeof NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  artifact: NixosSharedHostAdmittedArtifact;
  admittedContext: NixosSharedHostAdmittedContext;
  deployment: NixosSharedHostDeployment;
  platformStateSnapshotPath: string;
  hostConfigSnapshotPath: string;
  controlPlaneExecutionSnapshotPath?: string;
};

function replayBundleDir(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId);
}

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(replayBundleDir(recordsRoot, deployRunId), "snapshot.json");
}

function platformStateSnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(replayBundleDir(recordsRoot, deployRunId), "platform-state.json");
}

function hostConfigSnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(replayBundleDir(recordsRoot, deployRunId), "host-config.json");
}

async function writeSnapshotDocument(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeNixosSharedHostReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: NixosSharedHostDeployment;
  artifact: NixosSharedHostAdmittedArtifact;
  admittedContext: NixosSharedHostAdmittedContext;
  platformState: unknown;
  hostConfig: unknown;
  controlPlaneExecutionSnapshotPath?: string;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const platformStateSnapshotPath = platformStateSnapshotPathFor(
    opts.recordsRoot,
    opts.deployRunId,
  );
  const hostConfigSnapshotPath = hostConfigSnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  await writeSnapshotDocument(platformStateSnapshotPath, opts.platformState);
  await writeSnapshotDocument(hostConfigSnapshotPath, opts.hostConfig);
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const snapshot: NixosSharedHostReplaySnapshot = {
    schemaVersion: NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(opts.deployment),
    deploymentMetadataFingerprint,
    artifact: opts.artifact,
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    platformStateSnapshotPath,
    hostConfigSnapshotPath,
    ...(opts.controlPlaneExecutionSnapshotPath
      ? { controlPlaneExecutionSnapshotPath: opts.controlPlaneExecutionSnapshotPath }
      : {}),
  };
  await writeSnapshotDocument(replaySnapshotPath, snapshot);
  return {
    replaySnapshotPath,
    deploymentMetadataFingerprint,
    platformStateSnapshotPath,
    hostConfigSnapshotPath,
  };
}

export async function readNixosSharedHostReplaySnapshot(
  replaySnapshotPath: string,
): Promise<NixosSharedHostReplaySnapshot> {
  return JSON.parse(
    await fsp.readFile(replaySnapshotPath, "utf8"),
  ) as NixosSharedHostReplaySnapshot;
}

function requireReplaySnapshotPath(record: NixosSharedHostDeployRecord): string {
  if (typeof record.replaySnapshotPath === "string" && record.replaySnapshotPath.trim()) {
    return record.replaySnapshotPath;
  }
  if (record.runClassification === "explicit_removal") {
    throw new Error(`source run does not carry a publishable artifact: ${record.deployRunId}
wrong run classification: ${record.runClassification}`);
  }
  throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
}

export async function resolveNixosSharedHostReplaySource(opts: {
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
}) {
  if (!opts.recordPath && (!opts.recordsRoot || !opts.deployRunId)) {
    throw new Error(
      "resolve replay source requires --record-path or --records-root plus --deploy-run-id",
    );
  }
  const recordPath = opts.recordPath
    ? path.resolve(opts.recordPath)
    : deployRecordPathFor(String(opts.recordsRoot || ""), String(opts.deployRunId || ""));
  const record = await readNixosSharedHostDeployRecord(recordPath);
  const replaySnapshot = await readNixosSharedHostReplaySnapshot(requireReplaySnapshotPath(record));
  const artifactDir = await requireNixosSharedHostAdmittedArtifactPath(replaySnapshot.artifact);
  return { record, recordPath, replaySnapshot, artifactDir };
}

export async function resolveNixosSharedHostReplaySelection(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  sourceRunId: string;
  rollback: boolean;
}) {
  const source = await resolveNixosSharedHostReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const errors = sameDeploymentReplayErrors(opts.deployment, source.replaySnapshot.deployment);
  if (errors.length > 0) {
    throw new Error(`shared replay source is not compatible with the current deployment:
${errors.join("\n")}`);
  }
  const rollbackErrors = opts.rollback ? rollbackSourceEligibilityErrors(source.record) : [];
  if (rollbackErrors.length > 0) {
    throw new Error(`rollback source run is not eligible: ${source.record.deployRunId}
${rollbackErrors.join("\n")}`);
  }
  const liveCompatibilityErrors = opts.rollback
    ? await liveRollbackCompatibilityErrors({
        recordsRoot: opts.recordsRoot,
        deploymentId: opts.deployment.deploymentId,
        sourceRunId: source.record.deployRunId,
      })
    : [];
  if (liveCompatibilityErrors.length > 0) {
    throw new Error(`rollback source run is blocked by current release-action posture:
${liveCompatibilityErrors.join("\n")}`);
  }
  return {
    operationKind: opts.rollback ? "rollback" : "retry",
    deployment: opts.deployment,
    artifact: source.replaySnapshot.artifact,
    parentRunId: source.record.deployRunId,
    ...(source.record.releaseLineageId ? { releaseLineageId: source.record.releaseLineageId } : {}),
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    recordPath: source.recordPath,
    replaySnapshotPath: requireReplaySnapshotPath(source.record),
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
  };
}
