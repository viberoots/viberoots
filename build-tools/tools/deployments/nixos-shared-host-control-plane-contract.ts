#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";

export const NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA =
  "nixos-shared-host-control-plane-snapshot@2";
export const NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA =
  "nixos-shared-host-control-plane-submission@1";

export type NixosSharedHostPublishBehavior = "deploy" | "publish-only";

export type NixosSharedHostControlPlaneOperationKind =
  | "deploy"
  | "promotion"
  | "retry"
  | "rollback"
  | "explicit_removal";

export type NixosSharedHostSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

export type NixosSharedHostControlPlanePaths = {
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  hostConfigPath?: string;
};

export type NixosSharedHostControlPlaneSnapshot = {
  schemaVersion: typeof NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployBatchId?: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: NixosSharedHostDeployment;
  admittedContext?: NixosSharedHostAdmittedContext;
  paths: NixosSharedHostControlPlanePaths;
  action:
    | {
        kind: "deploy";
        publishBehavior: NixosSharedHostPublishBehavior;
        publishInput: {
          kind: "exact-artifact";
          artifact: NixosSharedHostAdmittedArtifact;
        };
        parentRunId?: string;
        releaseLineageId?: string;
        artifactLineageId?: string;
        sourceRecordPath?: string;
        sourceReplaySnapshotPath?: string;
      }
    | { kind: "explicit_removal" };
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
};

export type NixosSharedHostControlPlaneAdmission =
  | { decision: "admitted"; reason: "shared_nonprod" }
  | { decision: "rejected"; reason: "lock_conflict" };

export type NixosSharedHostControlPlaneSubmission = {
  schemaVersion: typeof NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA;
  submissionId: string;
  submittedAt: string;
  completedAt?: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  executionSnapshotPath: string;
  workerId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  admission: NixosSharedHostControlPlaneAdmission;
};

export type NixosSharedHostControlPlaneWorkerAuthority = {
  kind: "control-plane-worker";
  submissionId: string;
  submissionPath: string;
  workerId: string;
  lockScope: string;
  executionSnapshotPath: string;
};

export function requireNixosSharedHostControlPlaneAuthority(
  deployment: NixosSharedHostDeployment,
  authority?: NixosSharedHostControlPlaneWorkerAuthority,
): NixosSharedHostControlPlaneWorkerAuthority {
  if (deployment.protectionClass !== "shared_nonprod") {
    throw new Error(
      `unsupported protection_class "${deployment.protectionClass}" for nixos-shared-host mutation`,
    );
  }
  if (authority?.kind === "control-plane-worker") return authority;
  throw new Error(
    `nixos-shared-host ${deployment.protectionClass} mutation must execute through the shared control plane`,
  );
}
