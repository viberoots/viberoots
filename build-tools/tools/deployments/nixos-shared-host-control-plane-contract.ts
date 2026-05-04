#!/usr/bin/env zx-wrapper
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results";
import type { NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { NixosSharedHostPublishInput } from "./nixos-shared-host-publish-input";
import type { NixosSharedHostRecordedReleaseAction } from "./nixos-shared-host-provenance";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import type {
  DeploymentControlPlaneApprovalSummary,
  DeploymentControlPlaneArtifactStatus,
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneLifecycleState,
  DeploymentControlPlaneRequestDedupe,
  DeploymentControlPlaneSubmitRejectionCode,
  DeploymentControlPlaneServiceInstance,
  DeploymentControlPlaneTerminationReason,
} from "./deployment-control-plane-contract";
import type {
  DeploymentAdmissionEvidence,
  DeploymentPrincipal,
} from "./deployment-admission-evidence";
import type { DeploymentWorkerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker";
import type { DeploymentArtifactBindingProvenance } from "./deployment-artifact-binding";

export const NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA =
  "nixos-shared-host-control-plane-snapshot@4";
export const NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA =
  "nixos-shared-host-control-plane-submission@3";

export type NixosSharedHostPublishBehavior = "deploy" | "publish-only" | "provision-only";
export type NixosSharedHostBootstrapMode = "first_install" | "offline_recovery";

export type NixosSharedHostControlPlaneOperationKind =
  | "deploy"
  | "promotion"
  | "provision_only"
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
  artifactStagingRoot?: string;
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
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  recordedReleaseActions?: NixosSharedHostRecordedReleaseAction[];
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  admittedContext?: NixosSharedHostAdmittedContext;
  admissionEvidence?: DeploymentAdmissionEvidence;
  vaultRuntime?: DeploymentWorkerVaultRuntimeMetadata;
  paths: NixosSharedHostControlPlanePaths;
  action:
    | {
        kind: "deploy";
        publishBehavior: NixosSharedHostPublishBehavior;
        publishInput?: NixosSharedHostPublishInput;
        parentRunId?: string;
        releaseLineageId?: string;
        artifactLineageId?: string;
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
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  rejectionCode?: DeploymentControlPlaneSubmitRejectionCode;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  approval?: DeploymentControlPlaneApprovalSummary;
  artifact?: DeploymentControlPlaneArtifactStatus;
  artifactBinding?: DeploymentArtifactBindingProvenance;
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume" | "abort" | "approve";
    submittedAt: string;
    dedupe: DeploymentControlPlaneRequestDedupe;
    lifecycleState: DeploymentControlPlaneLifecycleState;
    requestedBy?: DeploymentPrincipal;
    authorizationSnapshot?: DeploymentControlPlaneAuthorization;
    rejectionCode?: DeploymentControlPlaneSubmitRejectionCode | "not_resumable" | "not_paused";
  };
  execution?: {
    currentStep:
      | "provision"
      | "publish"
      | "smoke"
      | "release_actions.pre_publish"
      | "release_actions.post_publish_pre_smoke"
      | "release_actions.post_smoke";
    mutationStartedAt?: string;
  };
  cancellationRequested?: {
    requestedAt: string;
    requestedBy: DeploymentPrincipal;
  };
  cancellationSummary?: {
    requestedAt: string;
    requestedBy: DeploymentPrincipal;
    activeStep:
      | "provision"
      | "publish"
      | "smoke"
      | "release_actions.pre_publish"
      | "release_actions.post_publish_pre_smoke"
      | "release_actions.post_smoke";
    mutationMayHaveStarted: boolean;
    enteredReconciliation: boolean;
    terminalizationPath:
      | "cancelled_without_mutation"
      | "finished_after_reconciliation"
      | "failed_after_reconciliation";
  };
  recovery?: {
    occurred: true;
    inDoubtStep:
      | "provision"
      | "publish"
      | "smoke"
      | "release_actions.pre_publish"
      | "release_actions.post_publish_pre_smoke"
      | "release_actions.post_smoke";
    providerReconciliation: "mutation_completed" | "mutation_not_observed" | "inconclusive";
    decision:
      | "resumed_execution"
      | "converged_to_final_record"
      | "terminated_for_operator_follow_up";
    recoveredAt: string;
    authorityReacquired: boolean;
    recoveredBy?: DeploymentPrincipal;
  };
  admission: NixosSharedHostControlPlaneAdmission;
};

export type NixosSharedHostControlPlaneWorkerAuthority = {
  kind: "control-plane-worker";
  submissionId: string;
  submissionPath: string;
  workerId: string;
  lockScope: string;
  fencingToken?: string;
  executionSnapshotPath: string;
};

export type NixosSharedHostBreakGlassAuthority = {
  kind: "break-glass-worker";
  incidentRef: string;
  freezeId: string;
  freezePath: string;
  evidencePath: string;
  requestedBy: DeploymentPrincipal;
  approvedBy?: DeploymentPrincipal;
  executedBy: DeploymentPrincipal;
  justification: string;
  bypassReason: string;
  selection: { kind: "exact_artifact"; artifactIdentity: string };
};

export type NixosSharedHostBootstrapAuthority = {
  kind: "bootstrap-worker";
  mode: NixosSharedHostBootstrapMode;
  evidencePath: string;
  executionSnapshotPath: string;
  lockScope: string;
  requestedBy: DeploymentPrincipal;
  executedBy: DeploymentPrincipal;
  ownershipProof: string;
  targetIdentityProof: string;
  selection: { kind: "exact_artifact"; artifactIdentity: string };
};

export type NixosSharedHostMutationAuthority =
  | NixosSharedHostControlPlaneWorkerAuthority
  | NixosSharedHostBreakGlassAuthority
  | NixosSharedHostBootstrapAuthority;

export function requireNixosSharedHostControlPlaneAuthority(
  deployment: NixosSharedHostDeployment,
  authority?: NixosSharedHostMutationAuthority,
): NixosSharedHostMutationAuthority {
  if (deployment.protectionClass !== "shared_nonprod") {
    throw new Error(
      `unsupported protection_class "${deployment.protectionClass}" for nixos-shared-host mutation`,
    );
  }
  if (
    authority?.kind === "control-plane-worker" ||
    authority?.kind === "break-glass-worker" ||
    authority?.kind === "bootstrap-worker"
  )
    return authority;
  throw new Error(
    `nixos-shared-host ${deployment.protectionClass} mutation must execute through the shared control plane`,
  );
}
