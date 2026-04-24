#!/usr/bin/env zx-wrapper
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_RESPONSE_SCHEMA,
  DEPLOYMENT_CONTROL_PLANE_STATUS_SCHEMA,
  DEPLOYMENT_CONTROL_PLANE_SUBMIT_RESPONSE_SCHEMA,
  type DeploymentControlPlaneApprovalSummary,
  type DeploymentControlPlaneAuthorization,
  type DeploymentControlPlaneResponseBase,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneRunActionResponse,
  type DeploymentControlPlaneStatus,
  type DeploymentControlPlaneSubmitResponse,
} from "./deployment-control-plane-contract.ts";
import { normalizeAuthorizationSnapshot } from "./deployment-control-plane-authz.ts";

type SubmissionLike = DeploymentControlPlaneResponseBase;

function toPublicApprovalSummary(
  approval: DeploymentControlPlaneApprovalSummary,
): DeploymentControlPlaneApprovalSummary {
  return {
    state: approval.state,
    approvalNames: approval.approvalNames,
    payloadFingerprint: approval.payloadFingerprint,
    targetIdentity: approval.targetIdentity,
    ...(approval.sourceRunId ? { sourceRunId: approval.sourceRunId } : {}),
    ...(approval.artifactIdentity ? { artifactIdentity: approval.artifactIdentity } : {}),
    ...(approval.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: approval.provisionerPlanFingerprint }
      : {}),
    ...(approval.grantedAt ? { grantedAt: approval.grantedAt } : {}),
    ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
    ...(approval.approvalId ? { approvalId: approval.approvalId } : {}),
    ...(approval.approver ? { approver: approval.approver } : {}),
  };
}

function toPublicAuthorizationSnapshot(
  authorization: DeploymentControlPlaneAuthorization,
): DeploymentControlPlaneAuthorization {
  return normalizeAuthorizationSnapshot(authorization);
}

function toStatusBase(submission: SubmissionLike): DeploymentControlPlaneResponseBase {
  return {
    submissionId: submission.submissionId,
    submittedAt: submission.submittedAt,
    ...(submission.completedAt ? { completedAt: submission.completedAt } : {}),
    deploymentId: submission.deploymentId,
    deploymentLabel: submission.deploymentLabel,
    operationKind: submission.operationKind,
    providerTargetIdentity: submission.providerTargetIdentity,
    lockScope: submission.lockScope,
    lifecycleState: submission.lifecycleState,
    terminationReason: submission.terminationReason,
    ...(submission.workerId ? { workerId: submission.workerId } : {}),
    ...(submission.deployRunId ? { deployRunId: submission.deployRunId } : {}),
    ...(submission.finalOutcome ? { finalOutcome: submission.finalOutcome } : {}),
    ...(submission.progressiveRollout ? { progressiveRollout: submission.progressiveRollout } : {}),
    dedupe: submission.dedupe,
    ...(submission.requestedBy ? { requestedBy: submission.requestedBy } : {}),
    ...(submission.authorization ? { authorization: submission.authorization } : {}),
    ...(submission.authorizationSnapshot
      ? { authorizationSnapshot: toPublicAuthorizationSnapshot(submission.authorizationSnapshot) }
      : {}),
    ...(submission.rejectionCode ? { rejectionCode: submission.rejectionCode } : {}),
    ...(submission.pendingReasonCode ? { pendingReasonCode: submission.pendingReasonCode } : {}),
    ...(submission.approval ? { approval: toPublicApprovalSummary(submission.approval) } : {}),
    ...(submission.artifact ? { artifact: submission.artifact } : {}),
    ...(submission.artifactBinding ? { artifactBinding: submission.artifactBinding } : {}),
    ...(submission.latestAction
      ? {
          latestAction: {
            ...submission.latestAction,
            ...(submission.latestAction.authorizationSnapshot
              ? {
                  authorizationSnapshot: toPublicAuthorizationSnapshot(
                    submission.latestAction.authorizationSnapshot,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}

export function submitResponseFromSubmission(
  submission: SubmissionLike,
): DeploymentControlPlaneSubmitResponse {
  return {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_SUBMIT_RESPONSE_SCHEMA,
    ...toStatusBase(submission),
  };
}

export function statusFromSubmission(submission: SubmissionLike): DeploymentControlPlaneStatus {
  return {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_STATUS_SCHEMA,
    ...toStatusBase(submission),
  };
}

export function runActionResponseFromSubmission(
  submission: SubmissionLike,
  actionId: string,
  action: DeploymentControlPlaneRunAction,
): DeploymentControlPlaneRunActionResponse {
  return {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_RESPONSE_SCHEMA,
    ...toStatusBase(submission),
    actionId,
    action,
  };
}
