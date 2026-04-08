#!/usr/bin/env zx-wrapper
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";

export function createNixosSharedHostControlPlaneSubmission(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    admission: NixosSharedHostControlPlaneSubmission["admission"];
    lifecycleState: NixosSharedHostControlPlaneSubmission["lifecycleState"];
    dedupe: NixosSharedHostControlPlaneSubmission["dedupe"];
    workerId?: string;
    completedAt?: string;
    terminationReason?: NixosSharedHostControlPlaneSubmission["terminationReason"];
    deployRunId?: string;
    resultRecordPath?: string;
    finalOutcome?: string;
    requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
    authorization?: NixosSharedHostControlPlaneSubmission["authorization"];
    rejectionCode?: NixosSharedHostControlPlaneSubmission["rejectionCode"];
    pendingReasonCode?: NixosSharedHostControlPlaneSubmission["pendingReasonCode"];
    latestAction?: NixosSharedHostControlPlaneSubmission["latestAction"];
  },
): NixosSharedHostControlPlaneSubmission {
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId: snapshot.submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: snapshot.deploymentId,
    deploymentLabel: snapshot.deploymentLabel,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    executionSnapshotPath,
    lifecycleState: opts.lifecycleState,
    terminationReason: opts.terminationReason ?? null,
    dedupe: opts.dedupe,
    ...(opts.workerId ? { workerId: opts.workerId } : {}),
    ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
    ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
    ...(opts.resultRecordPath ? { resultRecordPath: opts.resultRecordPath } : {}),
    ...(opts.finalOutcome ? { finalOutcome: opts.finalOutcome } : {}),
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    ...(opts.rejectionCode ? { rejectionCode: opts.rejectionCode } : {}),
    ...(opts.pendingReasonCode ? { pendingReasonCode: opts.pendingReasonCode } : {}),
    ...(opts.latestAction ? { latestAction: opts.latestAction } : {}),
    admission: opts.admission,
  };
}
