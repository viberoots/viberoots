#!/usr/bin/env zx-wrapper
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_RESPONSE_SCHEMA,
  DEPLOYMENT_CONTROL_PLANE_STATUS_SCHEMA,
  DEPLOYMENT_CONTROL_PLANE_SUBMIT_RESPONSE_SCHEMA,
  type DeploymentControlPlaneResponseBase,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneRunActionResponse,
  type DeploymentControlPlaneStatus,
  type DeploymentControlPlaneSubmitResponse,
} from "./deployment-control-plane-contract.ts";

type SubmissionLike = DeploymentControlPlaneResponseBase;

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
    executionSnapshotPath: submission.executionSnapshotPath,
    ...(submission.workerId ? { workerId: submission.workerId } : {}),
    ...(submission.deployRunId ? { deployRunId: submission.deployRunId } : {}),
    ...(submission.resultRecordPath ? { resultRecordPath: submission.resultRecordPath } : {}),
    ...(submission.finalOutcome ? { finalOutcome: submission.finalOutcome } : {}),
    ...(submission.progressiveRollout ? { progressiveRollout: submission.progressiveRollout } : {}),
    dedupe: submission.dedupe,
    ...(submission.requestedBy ? { requestedBy: submission.requestedBy } : {}),
    ...(submission.authorization ? { authorization: submission.authorization } : {}),
    ...(submission.rejectionCode ? { rejectionCode: submission.rejectionCode } : {}),
    ...(submission.pendingReasonCode ? { pendingReasonCode: submission.pendingReasonCode } : {}),
    ...(submission.approval ? { approval: submission.approval } : {}),
    ...(submission.latestAction ? { latestAction: submission.latestAction } : {}),
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
