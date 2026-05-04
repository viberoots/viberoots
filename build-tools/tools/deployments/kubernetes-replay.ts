#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention";
import {
  kubernetesRunnerIdentities,
  runnerIdentityCompatibilityErrors,
  type DeploymentRunnerIdentities,
} from "./deployment-runner-identities";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import { readKubernetesDeployRecord, type KubernetesDeployRecord } from "./kubernetes-records-read";
import type { KubernetesAdmittedContext } from "./kubernetes-admission";
import type { KubernetesDeployment } from "./contract";

export const KUBERNETES_REPLAY_SNAPSHOT_SCHEMA = "kubernetes-replay-snapshot@1";

export type KubernetesReplaySnapshot = {
  schemaVersion: typeof KUBERNETES_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  runnerIdentities: DeploymentRunnerIdentities;
  artifactIdentity: string;
  componentArtifacts: Array<{ componentId: string; identity: string; storedArtifactPath: string }>;
  admittedContext: KubernetesAdmittedContext;
  deployment: KubernetesDeployment;
  providerConfigSnapshotPath: string;
};

export function replaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId, "snapshot.json");
}

export async function writeKubernetesReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: KubernetesDeployment;
  artifactIdentity: string;
  componentArtifacts: KubernetesReplaySnapshot["componentArtifacts"];
  admittedContext: KubernetesAdmittedContext;
  providerConfigSnapshotPath: string;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const snapshot: KubernetesReplaySnapshot = {
    schemaVersion: KUBERNETES_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
    runnerIdentities: kubernetesRunnerIdentities(opts.deployment),
    artifactIdentity: opts.artifactIdentity,
    componentArtifacts: opts.componentArtifacts,
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    providerConfigSnapshotPath: path.resolve(opts.providerConfigSnapshotPath),
  };
  await fsp.mkdir(path.dirname(replaySnapshotPath), { recursive: true });
  await fsp.writeFile(replaySnapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return replaySnapshotPath;
}

export async function resolveKubernetesReplaySource(opts: {
  recordsRoot: string;
  deployRunId: string;
}) {
  const recordPath = path.join(path.resolve(opts.recordsRoot), "runs", `${opts.deployRunId}.json`);
  const record = await readKubernetesDeployRecord(recordPath);
  if (!record.replaySnapshotPath) {
    throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
  }
  const replaySnapshot = await readVersionedJson(record.replaySnapshotPath, {
    kind: "kubernetes replay snapshot",
    currentSchemaVersion: KUBERNETES_REPLAY_SNAPSHOT_SCHEMA,
    validateCurrent: (raw): raw is KubernetesReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
  const expected = kubernetesRunnerIdentities(replaySnapshot.deployment);
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
    artifacts: replaySnapshot.componentArtifacts.map((artifact) => ({
      identity: artifact.identity,
      storedArtifactPath: artifact.storedArtifactPath,
    })),
    replayBundlePaths: [replaySnapshot.providerConfigSnapshotPath],
    evidence: replaySnapshot.admittedContext.policyEvaluation,
  });
  return { record, recordPath, replaySnapshot };
}
