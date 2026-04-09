#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import {
  admitNixosSharedHostComponentArtifacts,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts.ts";
import {
  admitNixosSharedHostStaticArtifact,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  resolveInitialNixosSharedHostAdmittedContext,
  resolvePromotionNixosSharedHostAdmittedContext,
  resolveReplayNixosSharedHostAdmittedContext,
} from "./nixos-shared-host-admission.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import {
  isMultiComponentNixosSharedHostDeployment,
  nixosSharedHostDeploymentTargetIdentity,
} from "./nixos-shared-host-components.ts";
import { nixosSharedHostPublishInputArtifactIdentity } from "./nixos-shared-host-publish-input.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";
import { createNixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout.ts";
import { normalizeSingleComponentArtifactInput } from "./nixos-shared-host-single-component-artifact-input.ts";
import {
  hasReplaySnapshot,
  publishInputFor,
  recordedComponentResults,
} from "./nixos-shared-host-control-plane-snapshot-helpers.ts";

export type NixosSharedHostControlPlaneSourceSelection = {
  record: NixosSharedHostDeployRecord | { deployRunId: string; deploymentId: string };
  recordPath?: string;
  replaySnapshotPath?: string;
  replaySnapshot?: NixosSharedHostReplaySnapshot;
};

export type NixosSharedHostControlPlaneSnapshotOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
};

export function createNixosSharedHostSubmissionId(): string {
  return `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createNixosSharedHostWorkerId(submissionId: string): string {
  return `${submissionId}-worker`;
}

export async function createNixosSharedHostControlPlaneSnapshot(
  opts: NixosSharedHostControlPlaneSnapshotOpts,
  submissionId: string,
): Promise<NixosSharedHostControlPlaneSnapshot> {
  const submittedAt = new Date().toISOString();
  const multiComponent = isMultiComponentNixosSharedHostDeployment(opts.deployment);
  const lockScope = nixosSharedHostDeploymentTargetIdentity(opts.deployment);
  if (
    (opts.operationKind === "retry" || opts.operationKind === "rollback") &&
    !hasReplaySnapshot(opts.source)
  ) {
    throw new Error(`shared control-plane ${opts.operationKind} submission requires source run`);
  }
  if (opts.operationKind === "promotion" && !opts.source) {
    throw new Error("shared control-plane promotion submission requires source run");
  }
  if (multiComponent && (opts.artifact || opts.artifactDir)) {
    throw new Error(
      "multi-component nixos-shared-host deployments require per-component exact artifact inputs",
    );
  }
  const singleComponentArtifacts =
    !multiComponent && opts.operationKind !== "explicit_removal"
      ? opts.componentArtifacts ||
        (opts.artifactDirsByComponentId
          ? await admitNixosSharedHostComponentArtifacts({
              deployment: opts.deployment,
              recordsRoot: opts.paths.recordsRoot,
              artifactDirsByComponentId: opts.artifactDirsByComponentId,
            })
          : undefined)
      : undefined;
  if (
    opts.operationKind !== "explicit_removal" &&
    opts.operationKind !== "provision_only" &&
    !opts.artifact &&
    !opts.artifactDir &&
    !opts.componentArtifacts &&
    !opts.artifactDirsByComponentId
  ) {
    throw new Error(
      `shared control-plane ${opts.operationKind} submission requires exact artifact input`,
    );
  }
  const artifact =
    opts.operationKind === "explicit_removal" || multiComponent
      ? undefined
      : normalizeSingleComponentArtifactInput({
          deployment: opts.deployment,
          artifact: opts.artifact,
          componentArtifacts: singleComponentArtifacts,
        }) ||
        (opts.operationKind === "provision_only" &&
        !opts.artifact &&
        !opts.artifactDir &&
        !(singleComponentArtifacts && singleComponentArtifacts.length > 0)
          ? undefined
          : await admitNixosSharedHostStaticArtifact({
              recordsRoot: opts.paths.recordsRoot,
              artifactDir: path.resolve(opts.artifactDir || ""),
            }));
  const componentArtifacts =
    opts.operationKind !== "explicit_removal" && multiComponent
      ? opts.componentArtifacts ||
        (await admitNixosSharedHostComponentArtifacts({
          deployment: opts.deployment,
          recordsRoot: opts.paths.recordsRoot,
          artifactDirsByComponentId: opts.artifactDirsByComponentId || {},
        }))
      : undefined;
  const publishInput =
    opts.operationKind === "explicit_removal"
      ? undefined
      : publishInputFor({
          artifact,
          componentArtifacts,
        });
  const artifactIdentity =
    opts.operationKind === "explicit_removal" || !publishInput
      ? undefined
      : nixosSharedHostPublishInputArtifactIdentity(publishInput);
  const admittedContext =
    opts.operationKind === "explicit_removal"
      ? undefined
      : opts.operationKind === "promotion"
        ? await resolvePromotionNixosSharedHostAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            artifactIdentity,
            sourceRecord: opts.source!.record,
          })
        : hasReplaySnapshot(opts.source)
          ? await resolveReplayNixosSharedHostAdmittedContext({
              workspaceRoot: opts.workspaceRoot,
              deployment: opts.deployment,
              artifactIdentity,
              sourceRecord: opts.source.record,
              sourceReplaySnapshot: opts.source.replaySnapshot,
              rollback: opts.operationKind === "rollback",
            })
          : await resolveInitialNixosSharedHostAdmittedContext({
              workspaceRoot: opts.workspaceRoot,
              deployment: opts.deployment,
              artifactIdentity,
            });
  const progressiveRollout = createNixosSharedHostProgressiveRollout(opts.deployment);
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt,
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(opts.deployment),
    lockScope,
    deployment: opts.deployment,
    ...(progressiveRollout ? { progressiveRollout } : {}),
    ...(hasReplaySnapshot(opts.source)
      ? { recordedReleaseActions: opts.source.replaySnapshot.deployment.releaseActions }
      : {}),
    ...(admittedContext ? { admittedContext } : {}),
    paths: {
      statePath: path.resolve(opts.paths.statePath),
      hostRoot: path.resolve(opts.paths.hostRoot),
      recordsRoot: path.resolve(opts.paths.recordsRoot),
      ...(opts.paths.hostConfigPath
        ? { hostConfigPath: path.resolve(opts.paths.hostConfigPath) }
        : {}),
    },
    action:
      opts.operationKind !== "explicit_removal"
        ? {
            kind: "deploy",
            publishBehavior: opts.publishBehavior || "deploy",
            ...(publishInput ? { publishInput } : {}),
            ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
            ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
            ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
            ...(opts.source?.recordPath ? { sourceRecordPath: opts.source.recordPath } : {}),
            ...(opts.source?.replaySnapshotPath
              ? { sourceReplaySnapshotPath: opts.source.replaySnapshotPath }
              : {}),
            ...(recordedComponentResults(opts.source)
              ? { recordedComponentResults: recordedComponentResults(opts.source) }
              : {}),
          }
        : { kind: "explicit_removal" },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}
