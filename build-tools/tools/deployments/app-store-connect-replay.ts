#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat.ts";
import type { AppStoreConnectAdmittedContext } from "./app-store-connect-admission.ts";
import type { AdmittedMobileAppArtifact } from "./app-store-connect-artifacts.ts";
import { requireAdmittedMobileAppArtifactPath } from "./app-store-connect-artifacts.ts";
import type { AppStoreConnectDeployment } from "./contract.ts";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention.ts";
import {
  appStoreConnectRunnerIdentities,
  runnerIdentityCompatibilityErrors,
  type DeploymentRunnerIdentities,
} from "./deployment-runner-identities.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import {
  deployRecordPathFor,
  readAppStoreConnectDeployRecord,
  type AppStoreConnectDeployRecord,
} from "./app-store-connect-records.ts";

export const APP_STORE_CONNECT_REPLAY_SNAPSHOT_SCHEMA = "app-store-connect-replay-snapshot@2";

export type AppStoreConnectReplaySnapshot = {
  schemaVersion: typeof APP_STORE_CONNECT_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  runnerIdentities: DeploymentRunnerIdentities;
  artifact: AdmittedMobileAppArtifact;
  admittedContext: AppStoreConnectAdmittedContext;
  deployment: AppStoreConnectDeployment;
  providerConfigSnapshotPath: string;
};

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId, "snapshot.json");
}

export async function writeAppStoreConnectReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: AppStoreConnectDeployment;
  artifact: AdmittedMobileAppArtifact;
  admittedContext: AppStoreConnectAdmittedContext;
  providerConfigSnapshotPath: string;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const snapshot: AppStoreConnectReplaySnapshot = {
    schemaVersion: APP_STORE_CONNECT_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
    runnerIdentities: appStoreConnectRunnerIdentities(opts.deployment),
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

export async function resolveAppStoreConnectReplaySource(opts: {
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
}): Promise<{
  record: AppStoreConnectDeployRecord;
  recordPath: string;
  replaySnapshot: AppStoreConnectReplaySnapshot;
  artifactPath: string;
}> {
  const recordPath = opts.recordPath
    ? path.resolve(opts.recordPath)
    : deployRecordPathFor(String(opts.recordsRoot || ""), String(opts.deployRunId || ""));
  const record = await readAppStoreConnectDeployRecord(recordPath);
  if (!record.replaySnapshotPath) {
    throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
  }
  const replaySnapshot = await readVersionedJson(record.replaySnapshotPath, {
    kind: "app-store-connect replay snapshot",
    currentSchemaVersion: APP_STORE_CONNECT_REPLAY_SNAPSHOT_SCHEMA,
    migrations: {
      "app-store-connect-replay-snapshot@1": (raw) =>
        ({
          ...raw,
          schemaVersion: APP_STORE_CONNECT_REPLAY_SNAPSHOT_SCHEMA,
          runnerIdentities:
            typeof raw.runnerIdentities === "object" && raw.runnerIdentities
              ? raw.runnerIdentities
              : appStoreConnectRunnerIdentities(raw.deployment as AppStoreConnectDeployment),
        }) as AppStoreConnectReplaySnapshot,
    },
    validateCurrent: (raw): raw is AppStoreConnectReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
  const expected = appStoreConnectRunnerIdentities(replaySnapshot.deployment);
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
    artifactPath: await requireAdmittedMobileAppArtifactPath(replaySnapshot.artifact),
  };
}
