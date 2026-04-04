#!/usr/bin/env zx-wrapper
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";

export function createNixosSharedHostControlPlaneSubmission(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  executionSnapshotPath: string,
  admission: NixosSharedHostControlPlaneSubmission["admission"],
  workerId?: string,
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
    ...(workerId ? { workerId } : {}),
    admission,
  };
}
