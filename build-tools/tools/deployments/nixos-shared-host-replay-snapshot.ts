#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat";
import {
  compositeNixosSharedHostArtifactIdentity,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results";
import type { NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components";
import {
  nixosSharedHostRunnerIdentities,
  recordedReleaseActionPlan,
  type NixosSharedHostRecordedReleaseAction,
  type NixosSharedHostRunnerIdentities,
} from "./nixos-shared-host-provenance";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import {
  nixosSharedHostPublishInputArtifactIdentity,
  type NixosSharedHostPublishInput,
} from "./nixos-shared-host-publish-input";

export const NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA = "nixos-shared-host-replay-snapshot@3";

export type NixosSharedHostReplaySnapshot = {
  schemaVersion: typeof NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deploymentMetadataFingerprint: string;
  artifactIdentity: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  publishInput: NixosSharedHostPublishInput;
  runnerIdentities: NixosSharedHostRunnerIdentities;
  releaseActionPlan?: NixosSharedHostRecordedReleaseAction[];
  componentResults?: NixosSharedHostComponentResult[];
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  admittedContext: NixosSharedHostAdmittedContext;
  deployment: NixosSharedHostDeployment;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
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

function replayPublishInput(opts: {
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity?: string;
}): NixosSharedHostPublishInput {
  if (opts.componentArtifacts?.length) {
    return {
      kind: "component-artifacts",
      components: opts.componentArtifacts,
      compositeArtifactIdentity:
        String(opts.compositeArtifactIdentity || "").trim() ||
        compositeNixosSharedHostArtifactIdentity(opts.componentArtifacts),
    };
  }
  if (!opts.artifact) {
    throw new Error("replay snapshot requires exact publish input");
  }
  return {
    kind: "exact-artifact",
    artifact: opts.artifact,
  };
}

export function nixosSharedHostReplayArtifactIdentity(
  snapshot: Pick<NixosSharedHostReplaySnapshot, "artifactIdentity" | "publishInput" | "artifact">,
): string {
  return (
    snapshot.artifactIdentity ||
    (snapshot.publishInput
      ? nixosSharedHostPublishInputArtifactIdentity(snapshot.publishInput)
      : snapshot.artifact?.identity || "")
  );
}

export async function writeNixosSharedHostReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: NixosSharedHostDeployment;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity?: string;
  admittedContext: NixosSharedHostAdmittedContext;
  platformState: unknown;
  hostConfig: unknown;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  controlPlaneExecutionSnapshotPath?: string;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
}) {
  const replaySnapshotPath = replaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const platformStateSnapshotPath = platformStateSnapshotPathFor(
    opts.recordsRoot,
    opts.deployRunId,
  );
  const hostConfigSnapshotPath = hostConfigSnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const publishInput = replayPublishInput(opts);
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
    artifactIdentity: nixosSharedHostPublishInputArtifactIdentity(publishInput),
    ...(publishInput.kind === "exact-artifact" ? { artifact: publishInput.artifact } : {}),
    publishInput,
    runnerIdentities: nixosSharedHostRunnerIdentities(
      opts.deployment,
      opts.deployment.releaseActions,
    ),
    ...(opts.deployment.releaseActions.length > 0
      ? { releaseActionPlan: recordedReleaseActionPlan(opts.deployment.releaseActions) }
      : {}),
    ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
    admittedContext: opts.admittedContext,
    deployment: opts.deployment,
    ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
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

export async function writeNixosSharedHostReplayComponentResults(
  replaySnapshotPath: string,
  componentResults: NixosSharedHostComponentResult[],
  progressiveRollout?: NixosSharedHostProgressiveRollout,
): Promise<void> {
  const snapshot = await readNixosSharedHostReplaySnapshot(replaySnapshotPath);
  await writeSnapshotDocument(replaySnapshotPath, {
    ...snapshot,
    componentResults,
    ...(progressiveRollout ? { progressiveRollout } : {}),
  } satisfies NixosSharedHostReplaySnapshot);
}

export async function readNixosSharedHostReplaySnapshot(
  replaySnapshotPath: string,
): Promise<NixosSharedHostReplaySnapshot> {
  return await readVersionedJson(replaySnapshotPath, {
    kind: "nixos-shared-host replay snapshot",
    currentSchemaVersion: NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
    migrations: {
      "nixos-shared-host-replay-snapshot@2": (raw) =>
        ({
          ...raw,
          schemaVersion: NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
          runnerIdentities:
            typeof raw.runnerIdentities === "object" && raw.runnerIdentities
              ? raw.runnerIdentities
              : nixosSharedHostRunnerIdentities(
                  raw.deployment as NixosSharedHostDeployment,
                  (raw.deployment as NixosSharedHostDeployment).releaseActions || [],
                ),
          releaseActionPlan: Array.isArray(raw.releaseActionPlan)
            ? raw.releaseActionPlan
            : recordedReleaseActionPlan(
                ((raw.deployment as NixosSharedHostDeployment).releaseActions || []).slice(),
              ),
        }) as NixosSharedHostReplaySnapshot,
    },
    validateCurrent: (raw): raw is NixosSharedHostReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}
