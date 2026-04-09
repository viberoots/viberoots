#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  compositeNixosSharedHostArtifactIdentity,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout.ts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan.ts";
import {
  nixosSharedHostPublishInputArtifactIdentity,
  type NixosSharedHostPublishInput,
} from "./nixos-shared-host-publish-input.ts";

export const NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA = "nixos-shared-host-replay-snapshot@2";

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
  return JSON.parse(
    await fsp.readFile(replaySnapshotPath, "utf8"),
  ) as NixosSharedHostReplaySnapshot;
}
