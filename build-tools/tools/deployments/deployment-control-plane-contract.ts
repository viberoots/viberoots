#!/usr/bin/env zx-wrapper
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type { DeploymentTarget } from "./contract.ts";

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
  | "cancelling"
  | "finished"
  | "cancelled";

export type DeploymentControlPlaneTerminationReason =
  | "cancelled"
  | "superseded"
  | "no_longer_admitted"
  | "lock_timeout"
  | null;

export type DeploymentControlPlaneSubmitRejectionCode =
  | "lock_conflict"
  | "approval_required"
  | "approval_no_longer_valid"
  | "idempotency_conflict"
  | "unauthorized"
  | "no_longer_admitted";

export type DeploymentControlPlaneRunActionRejectionCode =
  | "approval_required"
  | "approval_no_longer_valid"
  | "idempotency_conflict"
  | "unauthorized"
  | "not_resumable"
  | "no_longer_admitted";

export type DeploymentControlPlaneRole = "submitter" | "approver" | "operator" | "break_glass";

export type DeploymentControlPlaneScope =
  | { kind: "deployment_id"; value: string }
  | { kind: "provider_target_identity"; value: string }
  | { kind: "lane_policy"; value: string };

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

export type DeploymentControlPlaneRunAction = "cancel" | "resume";

export type DeploymentControlPlaneRunActionRequest = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA;
  actionId: string;
  submittedAt: string;
  submissionId: string;
  action: DeploymentControlPlaneRunAction;
  idempotencyKey?: string;
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
  executionSnapshotPath: string;
  workerId?: string;
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  rejectionCode?:
    | DeploymentControlPlaneSubmitRejectionCode
    | DeploymentControlPlaneRunActionRejectionCode;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  latestAction?: {
    actionId: string;
    action: DeploymentControlPlaneRunAction;
    submittedAt: string;
    dedupe: DeploymentControlPlaneRequestDedupe;
    lifecycleState: DeploymentControlPlaneLifecycleState;
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
