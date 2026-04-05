#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import { requireNixosSharedHostAdmittedArtifactPath } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
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
}): Promise<{
  replaySnapshotPath: string;
  deploymentMetadataFingerprint: string;
  platformStateSnapshotPath: string;
  hostConfigSnapshotPath: string;
}> {
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
    providerTargetIdentity: opts.deployment.providerTarget.sharedDevTargetIdentity,
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
}): Promise<{
  record: NixosSharedHostDeployRecord;
  recordPath: string;
  replaySnapshot: NixosSharedHostReplaySnapshot;
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
  const record = await readNixosSharedHostDeployRecord(recordPath);
  const replaySnapshot = await readNixosSharedHostReplaySnapshot(requireReplaySnapshotPath(record));
  const artifactDir = await requireNixosSharedHostAdmittedArtifactPath(replaySnapshot.artifact);
  return { record, recordPath, replaySnapshot, artifactDir };
}

function replayMismatch(field: string, expected: string, actual: string): string {
  return `${field} mismatch: current=${expected} source=${actual}`;
}

function sameDeploymentReplayErrors(
  current: NixosSharedHostDeployment,
  source: NixosSharedHostDeployment,
): string[] {
  const errors: string[] = [];
  if (current.deploymentId !== source.deploymentId) {
    errors.push(replayMismatch("deploymentId", current.deploymentId, source.deploymentId));
  }
  if (current.label !== source.label) {
    errors.push(replayMismatch("deploymentLabel", current.label, source.label));
  }
  if (current.provider !== source.provider) {
    errors.push(replayMismatch("provider", current.provider, source.provider));
  }
  if (
    current.providerTarget.sharedDevTargetIdentity !== source.providerTarget.sharedDevTargetIdentity
  ) {
    errors.push(
      replayMismatch(
        "providerTargetIdentity",
        current.providerTarget.sharedDevTargetIdentity,
        source.providerTarget.sharedDevTargetIdentity,
      ),
    );
  }
  if (current.publisher.type !== source.publisher.type) {
    errors.push(replayMismatch("publisherType", current.publisher.type, source.publisher.type));
  }
  if (current.component.kind !== source.component.kind) {
    errors.push(replayMismatch("componentKind", current.component.kind, source.component.kind));
  }
  return errors;
}

function rollbackEligibilityErrors(record: NixosSharedHostDeployRecord): string[] {
  const errors: string[] = [];
  if (record.finalOutcome !== "succeeded") {
    errors.push(`non-success final outcome: ${record.finalOutcome}`);
  }
  if (record.runClassification !== "deploy") {
    errors.push(`wrong run classification: ${record.runClassification}`);
  }
  if (record.publishMode !== "normal") {
    errors.push(`wrong publish mode: ${record.publishMode}`);
  }
  return errors;
}

export async function resolveNixosSharedHostReplaySelection(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  sourceRunId: string;
  rollback: boolean;
}): Promise<{
  operationKind: "retry" | "rollback";
  deployment: NixosSharedHostDeployment;
  artifact: NixosSharedHostAdmittedArtifact;
  parentRunId: string;
  releaseLineageId?: string;
  artifactLineageId: string;
  recordPath: string;
  replaySnapshotPath: string;
  sourceRecord: NixosSharedHostDeployRecord;
  sourceReplaySnapshot: NixosSharedHostReplaySnapshot;
}> {
  const source = await resolveNixosSharedHostReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const errors = sameDeploymentReplayErrors(opts.deployment, source.replaySnapshot.deployment);
  if (errors.length > 0) {
    throw new Error(`shared replay source is not compatible with the current deployment:
${errors.join("\n")}`);
  }
  const rollbackErrors = opts.rollback ? rollbackEligibilityErrors(source.record) : [];
  if (rollbackErrors.length > 0) {
    throw new Error(`rollback source run is not eligible: ${source.record.deployRunId}
${rollbackErrors.join("\n")}`);
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
