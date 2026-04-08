#!/usr/bin/env zx-wrapper
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostPublishInput } from "./nixos-shared-host-publish-input.ts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneLifecycleState,
  DeploymentControlPlaneRequestDedupe,
  DeploymentControlPlaneSubmitRejectionCode,
  DeploymentControlPlaneTerminationReason,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";

export const NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA =
  "nixos-shared-host-control-plane-snapshot@3";
export const NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA =
  "nixos-shared-host-control-plane-submission@2";

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
  recordedReleaseActions?: DeploymentReleaseAction[];
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  admittedContext?: NixosSharedHostAdmittedContext;
  paths: NixosSharedHostControlPlanePaths;
  action:
    | {
        kind: "deploy";
        publishBehavior: NixosSharedHostPublishBehavior;
        publishInput: NixosSharedHostPublishInput;
        parentRunId?: string;
        releaseLineageId?: string;
        artifactLineageId?: string;
        sourceRecordPath?: string;
        sourceReplaySnapshotPath?: string;
        recordedComponentResults?: NixosSharedHostComponentResult[];
      }
    | { kind: "explicit_removal" };
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
};

export type NixosSharedHostControlPlaneAdmission =
  | { decision: "admitted"; reason: "shared_nonprod" }
  | {
      decision: "pending_approval";
      reason: "approval_required" | "approval_no_longer_valid";
    }
  | { decision: "rejected"; reason: DeploymentControlPlaneSubmitRejectionCode };

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
  lifecycleState: DeploymentControlPlaneLifecycleState;
  terminationReason: DeploymentControlPlaneTerminationReason;
  dedupe: DeploymentControlPlaneRequestDedupe;
  workerId?: string;
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  rejectionCode?: DeploymentControlPlaneSubmitRejectionCode;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume";
    submittedAt: string;
    dedupe: DeploymentControlPlaneRequestDedupe;
    lifecycleState: DeploymentControlPlaneLifecycleState;
    rejectionCode?: DeploymentControlPlaneSubmitRejectionCode | "not_resumable";
  };
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
