#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import {
  admitNixosSharedHostComponentArtifacts,
  compositeNixosSharedHostArtifactIdentity,
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
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";

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

function hasReplaySnapshot(
  source?: NixosSharedHostControlPlaneSourceSelection,
): source is NixosSharedHostControlPlaneSourceSelection & {
  record: NixosSharedHostDeployRecord;
  replaySnapshot: NixosSharedHostReplaySnapshot;
} {
  return !!source?.replaySnapshot;
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
  if (
    multiComponent &&
    opts.operationKind !== "deploy" &&
    opts.operationKind !== "explicit_removal"
  ) {
    throw new Error(
      "multi-component nixos-shared-host deployments currently support normal deploy and explicit removal only",
    );
  }
  if (multiComponent && (opts.artifact || opts.artifactDir)) {
    throw new Error(
      "multi-component nixos-shared-host deployments require per-component exact artifact inputs",
    );
  }
  if (!multiComponent && (opts.componentArtifacts || opts.artifactDirsByComponentId)) {
    throw new Error(
      "single-component nixos-shared-host deployments must use a single exact artifact input",
    );
  }
  if (
    opts.operationKind !== "explicit_removal" &&
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
      : opts.artifact ||
        (await admitNixosSharedHostStaticArtifact({
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
  const artifactIdentity =
    opts.operationKind === "explicit_removal"
      ? undefined
      : componentArtifacts && componentArtifacts.length > 0
        ? compositeNixosSharedHostArtifactIdentity(componentArtifacts)
        : (artifact as NixosSharedHostAdmittedArtifact).identity;
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
            publishInput:
              componentArtifacts && componentArtifacts.length > 0
                ? {
                    kind: "component-artifacts",
                    components: componentArtifacts,
                    compositeArtifactIdentity: artifactIdentity,
                  }
                : {
                    kind: "exact-artifact",
                    artifact: artifact as NixosSharedHostAdmittedArtifact,
                  },
            ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
            ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
            ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
            ...(opts.source?.recordPath ? { sourceRecordPath: opts.source.recordPath } : {}),
            ...(opts.source?.replaySnapshotPath
              ? { sourceReplaySnapshotPath: opts.source.replaySnapshotPath }
              : {}),
          }
        : { kind: "explicit_removal" },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}
