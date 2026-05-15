#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention";
import {
  assertReplayAdmissionMatchesRecord,
  requireReplayAdmittedContext,
} from "./deployment-replay-admission";
import {
  runnerIdentityCompatibilityErrors,
  s3StaticRunnerIdentities,
  type DeploymentRunnerIdentities,
} from "./deployment-runner-identities";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import { readS3StaticDeployRecord, type S3StaticDeployRecord } from "./s3-static-records-read";
import type { S3StaticAdmittedContext } from "./s3-static-admission";
import type { S3StaticDeployment } from "./contract";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";
import { requireAdmittedStaticWebappArtifactPath } from "./static-webapp-artifacts";
import { restoreDurableArtifactObjectReferences } from "./control-plane-artifact-durable-refs";

export const S3_STATIC_REPLAY_SNAPSHOT_SCHEMA = "s3-static-replay-snapshot@1";

export type S3StaticReplaySnapshot = {
  schemaVersion: typeof S3_STATIC_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  runnerIdentities: DeploymentRunnerIdentities;
  artifact: AdmittedStaticWebappArtifact;
  admittedContext: S3StaticAdmittedContext;
  deployment: S3StaticDeployment;
  providerConfigSnapshotPath: string;
};

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId, "snapshot.json");
}

export async function writeS3StaticReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: S3StaticDeployment;
  artifact: AdmittedStaticWebappArtifact;
  admittedContext: S3StaticAdmittedContext;
  providerConfigSnapshotPath: string;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const snapshot: S3StaticReplaySnapshot = {
    schemaVersion: S3_STATIC_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
    runnerIdentities: s3StaticRunnerIdentities(opts.deployment),
    artifact: restoreDurableArtifactObjectReferences(structuredClone(opts.artifact)),
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    providerConfigSnapshotPath: path.resolve(opts.providerConfigSnapshotPath),
  };
  await fsp.mkdir(path.dirname(replaySnapshotPath), { recursive: true });
  await fsp.writeFile(replaySnapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return replaySnapshotPath;
}

export async function resolveS3StaticReplaySource(opts: {
  recordsRoot: string;
  deployRunId: string;
}) {
  const recordPath = path.join(path.resolve(opts.recordsRoot), "runs", `${opts.deployRunId}.json`);
  const record = await readS3StaticDeployRecord(recordPath);
  if (!record.replaySnapshotPath) {
    throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
  }
  const replaySnapshot = await readVersionedJson(record.replaySnapshotPath, {
    kind: "s3-static replay snapshot",
    currentSchemaVersion: S3_STATIC_REPLAY_SNAPSHOT_SCHEMA,
    validateCurrent: (raw): raw is S3StaticReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
  requireReplayAdmittedContext({
    provider: "s3-static",
    admittedContext: replaySnapshot.admittedContext,
  });
  assertReplayAdmissionMatchesRecord({
    provider: "s3-static",
    record,
    replaySnapshot,
  });
  const expected = s3StaticRunnerIdentities(replaySnapshot.deployment);
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
    artifactDir: replaySnapshot.artifact.object
      ? undefined
      : await requireAdmittedStaticWebappArtifactPath(replaySnapshot.artifact),
  };
}
