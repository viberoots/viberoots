#!/usr/bin/env zx-wrapper
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneArtifactStatus,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesControlPlaneSubmission,
} from "./cloudflare-pages-control-plane-contract.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";

function digestFromIdentity(identity: string): string | undefined {
  return identity.startsWith("static-webapp:")
    ? identity.slice("static-webapp:".length)
    : undefined;
}

function artifactStatusFromSnapshot(
  snapshot: CloudflarePagesControlPlaneSnapshot,
): DeploymentControlPlaneArtifactStatus | undefined {
  const action = snapshot.action;
  if (action.kind === "preview_cleanup") {
    return {
      phase: "admitted",
      producerKind: "existing_admitted_artifact",
      artifactIdentity: action.artifactIdentity,
      artifactDigest: digestFromIdentity(action.artifactIdentity),
    };
  }
  const artifact = action.publishInput.artifact;
  return {
    phase: "admitted",
    ...(artifact.producerKind ? { producerKind: artifact.producerKind } : {}),
    artifactIdentity: artifact.identity,
    artifactDigest: digestFromIdentity(artifact.identity),
    ...(artifact.sourceRevision ? { sourceRevision: artifact.sourceRevision } : {}),
    ...(artifact.buildTarget ? { buildTarget: artifact.buildTarget } : {}),
    ...(artifact.storageReference ? { storageReference: artifact.storageReference } : {}),
  };
}

export function createCloudflarePagesControlPlaneSubmission(
  deployment: CloudflarePagesDeployment,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    admission: CloudflarePagesControlPlaneSubmission["admission"];
    lifecycleState: CloudflarePagesControlPlaneSubmission["lifecycleState"];
    dedupe: DeploymentControlPlaneRequestDedupe;
    workerId?: string;
    completedAt?: string;
    terminationReason?: CloudflarePagesControlPlaneSubmission["terminationReason"];
    deployRunId?: string;
    resultRecordPath?: string;
    finalOutcome?: string;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorizationDecision;
    rejectionCode?: CloudflarePagesControlPlaneSubmission["rejectionCode"];
    pendingReasonCode?: CloudflarePagesControlPlaneSubmission["pendingReasonCode"];
  },
): CloudflarePagesControlPlaneSubmission {
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId: snapshot.submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
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
    ...(artifactStatusFromSnapshot(snapshot)
      ? { artifact: artifactStatusFromSnapshot(snapshot) }
      : {}),
    admission: opts.admission,
  };
}

export function createCloudflarePagesAdmittedTerminalSubmission(
  deployment: CloudflarePagesDeployment,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    terminationReason: "cancelled" | "superseded" | "no_longer_admitted" | "lock_timeout";
    dedupe: DeploymentControlPlaneRequestDedupe;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorizationDecision;
  },
): CloudflarePagesControlPlaneSubmission {
  return createCloudflarePagesControlPlaneSubmission(deployment, snapshot, executionSnapshotPath, {
    admission: {
      decision: "admitted",
      reason:
        deployment.protectionClass === "production_facing" ? "production_facing" : "shared_nonprod",
    },
    lifecycleState: opts.terminationReason === "cancelled" ? "cancelled" : "finished",
    completedAt: new Date().toISOString(),
    terminationReason: opts.terminationReason,
    dedupe: opts.dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
  });
}

export function createCloudflarePagesLockConflictSubmission(
  deployment: CloudflarePagesDeployment,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    dedupe: DeploymentControlPlaneRequestDedupe;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorizationDecision;
  },
): CloudflarePagesControlPlaneSubmission {
  return createCloudflarePagesControlPlaneSubmission(deployment, snapshot, executionSnapshotPath, {
    admission: { decision: "rejected", reason: "lock_conflict" },
    lifecycleState: "finished",
    completedAt: new Date().toISOString(),
    dedupe: opts.dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    rejectionCode: "lock_conflict",
  });
}
