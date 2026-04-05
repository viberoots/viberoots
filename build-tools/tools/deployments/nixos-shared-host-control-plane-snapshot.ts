#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import {
  admitNixosSharedHostStaticArtifact,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  resolveInitialNixosSharedHostAdmittedContext,
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
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";

export type NixosSharedHostControlPlaneSourceSelection = {
  record: NixosSharedHostDeployRecord;
  replaySnapshot: NixosSharedHostReplaySnapshot;
};

export type NixosSharedHostControlPlaneSnapshotOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  artifactDir?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
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
  const lockScope = opts.deployment.providerTarget.sharedDevTargetIdentity;
  if ((opts.operationKind === "retry" || opts.operationKind === "rollback") && !opts.source) {
    throw new Error(`shared control-plane ${opts.operationKind} submission requires source run`);
  }
  if (opts.operationKind !== "explicit_removal" && !opts.artifact && !opts.artifactDir) {
    throw new Error(
      `shared control-plane ${opts.operationKind} submission requires exact artifact input`,
    );
  }
  const artifact =
    opts.operationKind === "explicit_removal"
      ? undefined
      : opts.artifact ||
        (await admitNixosSharedHostStaticArtifact({
          recordsRoot: opts.paths.recordsRoot,
          artifactDir: path.resolve(opts.artifactDir || ""),
        }));
  const admittedContext =
    opts.operationKind === "explicit_removal"
      ? undefined
      : opts.source
        ? await resolveReplayNixosSharedHostAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            artifactIdentity: (artifact as NixosSharedHostAdmittedArtifact).identity,
            sourceRecord: opts.source.record,
            sourceReplaySnapshot: opts.source.replaySnapshot,
            rollback: opts.operationKind === "rollback",
          })
        : await resolveInitialNixosSharedHostAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            artifactIdentity: (artifact as NixosSharedHostAdmittedArtifact).identity,
          });
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt,
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.sharedDevTargetIdentity,
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
            publishInput: {
              kind: "exact-artifact",
              artifact: artifact as NixosSharedHostAdmittedArtifact,
            },
            ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
            ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
            ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
          }
        : { kind: "explicit_removal" },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}
