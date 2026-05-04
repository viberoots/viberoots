#!/usr/bin/env zx-wrapper
import type { DeploymentPrincipal } from "./deployment-admission-evidence";
import type { DeploymentArtifactBindingProvenance } from "./deployment-artifact-binding";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { DeploymentTarget } from "./contract";

export const DEPLOYMENT_EXTRACTED_METADATA_SCHEMA = "deployment-extracted-metadata@1";
export const DEPLOYMENT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "deployment-control-plane-submit-request@1";
export const DEPLOYMENT_CONTROL_PLANE_SUBMIT_RESPONSE_SCHEMA =
  "deployment-control-plane-submit-response@1";
export const DEPLOYMENT_CONTROL_PLANE_STATUS_SCHEMA = "deployment-control-plane-status@1";
export const DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA =
  "deployment-control-plane-run-action-request@1";
export const DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_RESPONSE_SCHEMA =
  "deployment-control-plane-run-action-response@1";
export const DEPLOYMENT_CONTROL_PLANE_REPLAY_SELECTOR_SCHEMA =
  "deployment-control-plane-replay-selector@1";

export type DeploymentControlPlaneLifecycleState =
  | "pending_approval"
  | "queued"
  | "waiting_for_lock"
  | "running"
  | "paused"
  | "cancelling"
  | "finished"
  | "cancelled";

export type DeploymentControlPlaneTerminationReason =
  | "cancelled"
  | "superseded"
  | "no_longer_admitted"
  | "lock_timeout"
  | null;

export type DeploymentControlPlaneApprovalState = "pending" | "granted" | "no_longer_valid";

export type DeploymentControlPlaneSubmitRejectionCode =
  | "lock_conflict"
  | "approval_required"
  | "approval_no_longer_valid"
  | "idempotency_conflict"
  | "unauthorized"
  | "no_longer_admitted"
  | "supersedence_blocked";

export type DeploymentControlPlaneRunActionRejectionCode =
  | "approval_required"
  | "approval_no_longer_valid"
  | "idempotency_conflict"
  | "unauthorized"
  | "not_resumable"
  | "no_longer_admitted"
  | "not_paused";

export type DeploymentControlPlaneAdmissionDomain = "all_deployments";

export type DeploymentControlPlaneRole =
  | "submitter"
  | "approver"
  | "admission_reporter"
  | "operator"
  | "break_glass"
  | "bootstrap";

export type DeploymentControlPlaneScope =
  | { kind: "deployment_id"; value: string }
  | { kind: "project"; value: string }
  | { kind: "environment_stage"; value: string }
  | { kind: "admission_domain"; value: DeploymentControlPlaneAdmissionDomain }
  | { kind: "provider_target_identity"; value: string }
  | { kind: "lane_policy"; value: string }
  | { kind: "break_glass_incident"; value: string }
  | { kind: "bootstrap_deployment"; value: string };

export type DeploymentControlPlaneGrant = {
  role: DeploymentControlPlaneRole;
  scope: DeploymentControlPlaneScope;
};

export type DeploymentControlPlaneAuthorization = {
  requestedBy: DeploymentPrincipal;
  grants: DeploymentControlPlaneGrant[];
};

export type DeploymentControlPlaneAuthorizationDecision = {
  principal: DeploymentPrincipal;
  role: DeploymentControlPlaneRole;
  scope: DeploymentControlPlaneScope;
};

export type DeploymentControlPlaneServiceInstance = {
  hostname: string;
  workspaceRoot: string;
  gitHead?: string;
  reviewedRef?: string;
  reviewedRepository?: string;
  reviewedRemoteName?: string;
  reviewedRemoteUrl?: string;
};

export type DeploymentControlPlaneRequestDedupe = {
  mode: "created" | "reused";
  requestFingerprint: string;
  idempotencyKey?: string;
};

export type DeploymentControlPlaneReplaySelector = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_REPLAY_SELECTOR_SCHEMA;
  deploymentId: string;
  sourceRunId: string;
  rollback: boolean;
};

export type DeploymentControlPlaneApprovalSummary = {
  state: DeploymentControlPlaneApprovalState;
  approvalNames: string[];
  payloadFingerprint: string;
  targetIdentity: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  provisionerPlanFingerprint?: string;
  grantedAt?: string;
  expiresAt?: string;
  approvalId?: string;
  approver?: DeploymentPrincipal;
};

export type DeploymentControlPlaneArtifactStatus = {
  phase: "admission_pending" | "admitted" | "unavailable" | "not_applicable";
  producerKind?:
    | "server_build"
    | "client_upload"
    | "ci_attested"
    | "existing_admitted_artifact"
    | "local_direct";
  artifactIdentity?: string;
  artifactDigest?: string;
  sourceRevision?: string;
  buildTarget?: string;
  storageReference?: string;
};

export type DeploymentControlPlaneApprovalGrantRequest = {
  approvalId?: string;
  approvalNames?: string[];
  expiresAt?: string;
  expectedPayloadFingerprint?: string;
  expectedTargetIdentity?: string;
  expectedProvisionerPlanFingerprint?: string;
};

export type DeploymentExtractedMetadataDocument = {
  schemaVersion: typeof DEPLOYMENT_EXTRACTED_METADATA_SCHEMA;
  deployments: DeploymentTarget[];
};

export type DeploymentControlPlaneSubmitRequest = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: DeploymentTarget;
  recordsRoot: string;
  operationKind: string;
  idempotencyKey?: string;
  sourceRunId?: string;
  replaySelector?: DeploymentControlPlaneReplaySelector;
  authorization?: DeploymentControlPlaneAuthorization;
};

export type DeploymentControlPlaneRunAction = "cancel" | "resume" | "abort" | "approve";

export type DeploymentControlPlaneRunActionRequest = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA;
  actionId: string;
  submittedAt: string;
  submissionId: string;
  action: DeploymentControlPlaneRunAction;
  idempotencyKey?: string;
  approval?: DeploymentControlPlaneApprovalGrantRequest;
  authorization?: DeploymentControlPlaneAuthorization;
};

export type DeploymentControlPlaneResponseBase = {
  submissionId: string;
  submittedAt: string;
  completedAt?: string;
  deploymentId: string;
  deploymentLabel: string;
  operationKind: string;
  providerTargetIdentity: string;
  lockScope: string;
  lifecycleState: DeploymentControlPlaneLifecycleState;
  terminationReason: DeploymentControlPlaneTerminationReason;
  workerId?: string;
  deployRunId?: string;
  finalOutcome?: string;
  execution?: {
    currentStep?: string;
    mutationStartedAt?: string;
    stepStartedAt?: string;
    timeoutMs?: number;
  };
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  rejectionCode?:
    | DeploymentControlPlaneSubmitRejectionCode
    | DeploymentControlPlaneRunActionRejectionCode;
  rejectionMessage?: string;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  approval?: DeploymentControlPlaneApprovalSummary;
  artifact?: DeploymentControlPlaneArtifactStatus;
  artifactBinding?: DeploymentArtifactBindingProvenance;
  latestAction?: {
    actionId: string;
    action: DeploymentControlPlaneRunAction;
    submittedAt: string;
    dedupe: DeploymentControlPlaneRequestDedupe;
    lifecycleState: DeploymentControlPlaneLifecycleState;
    requestedBy?: DeploymentPrincipal;
    authorizationSnapshot?: DeploymentControlPlaneAuthorization;
    rejectionCode?: DeploymentControlPlaneRunActionRejectionCode;
  };
};

export type DeploymentControlPlaneSubmitResponse = DeploymentControlPlaneResponseBase & {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_SUBMIT_RESPONSE_SCHEMA;
};

export type DeploymentControlPlaneStatus = DeploymentControlPlaneResponseBase & {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_STATUS_SCHEMA;
};

export type DeploymentControlPlaneRunActionResponse = DeploymentControlPlaneResponseBase & {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_RESPONSE_SCHEMA;
  actionId: string;
  action: DeploymentControlPlaneRunAction;
};
