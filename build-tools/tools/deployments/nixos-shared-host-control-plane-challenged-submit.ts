#!/usr/bin/env zx-wrapper
import { acceptChallengedArtifactSubmission } from "./deployment-artifact-submit-transaction";
import { readReusableChallengedArtifactSubmission } from "./deployment-artifact-submit-idempotency";
import {
  deploymentServicePrincipalForToken,
  verifyDeploymentArtifactChallenge,
} from "./deployment-artifact-challenges";
import { submitResponseFromSubmission } from "./deployment-control-plane-status";
import type { DeploymentControlPlaneServiceInstance } from "./deployment-control-plane-contract";
import { prepareBackendNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-backend-prepare";
import type { DeploymentControlPlaneAuthorizationDecision } from "./deployment-control-plane-contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract";
import { cleanupThenRethrowRejectedNixosSubmit } from "./nixos-shared-host-control-plane-rejection-cleanup";
import {
  assertProtectedSharedArtifactIdentityFields,
  finalizedStagedArtifactReference,
} from "./nixos-shared-host-artifact-submit-request";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";

type Boundary = {
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  admissionEvidence?: DeploymentAdmissionEvidence;
};

export async function acceptChallengedNixosSharedHostSubmit(opts: {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  serviceToken?: string;
  resolvedRequest: NixosSharedHostControlPlaneSubmitRequest;
  requestFingerprint: string;
  idempotencyKey: string;
  boundary: Boundary;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  governanceResolver?: DeploymentLaneGovernanceResolver;
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  objectStore?: ControlPlaneArtifactStore;
}) {
  assertProtectedSharedArtifactIdentityFields(opts.resolvedRequest);
  const reusable = await readReusableChallengedArtifactSubmission({
    backend: opts.backend,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
  });
  if (reusable) return submitResponseFromSubmission(reusable as any);
  const principal = deploymentServicePrincipalForToken(opts.serviceToken);
  const proofKeyId = opts.resolvedRequest.artifactBindingProof?.keyId || principal.keyId;
  await verifyDeploymentArtifactChallenge({
    backend: opts.backend,
    request: opts.resolvedRequest,
    proof: opts.resolvedRequest.artifactBindingProof,
    finalizedStagedArtifactReference: finalizedStagedArtifactReference(opts.resolvedRequest),
    principalId: principal.principalId,
    keyId: proofKeyId,
    proofSecret: principal.proofSecret,
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
  });
  const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: opts.resolvedRequest.operationKind,
    deployment: opts.resolvedRequest.deployment,
    paths: opts.paths,
    backend: opts.backend,
    submissionId: opts.resolvedRequest.submissionId,
    dedupe: {
      mode: "created",
      requestFingerprint: opts.requestFingerprint,
      ...(opts.resolvedRequest.idempotencyKey
        ? { idempotencyKey: opts.resolvedRequest.idempotencyKey }
        : {}),
    },
    requestedBy: opts.boundary.requestedBy,
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    ...(opts.resolvedRequest.deployBatchId
      ? { deployBatchId: opts.resolvedRequest.deployBatchId }
      : {}),
    ...(opts.resolvedRequest.artifactDir ? { artifactDir: opts.resolvedRequest.artifactDir } : {}),
    ...(opts.resolvedRequest.artifactDirsByComponentId
      ? { artifactDirsByComponentId: opts.resolvedRequest.artifactDirsByComponentId }
      : {}),
    ...(opts.resolvedRequest.expectedArtifactIdentity
      ? { expectedArtifactIdentity: opts.resolvedRequest.expectedArtifactIdentity }
      : {}),
    ...(opts.resolvedRequest.expectedComponentArtifactIdentities
      ? {
          expectedComponentArtifactIdentities:
            opts.resolvedRequest.expectedComponentArtifactIdentities,
        }
      : {}),
    ...(opts.resolvedRequest.expectedCompositeArtifactIdentity
      ? {
          expectedCompositeArtifactIdentity: opts.resolvedRequest.expectedCompositeArtifactIdentity,
        }
      : {}),
    ...(opts.resolvedRequest.expectedSourceRevision
      ? { expectedSourceRevision: opts.resolvedRequest.expectedSourceRevision }
      : {}),
    ...(opts.resolvedRequest.artifact ? { artifact: opts.resolvedRequest.artifact } : {}),
    ...(opts.resolvedRequest.componentArtifacts
      ? { componentArtifacts: opts.resolvedRequest.componentArtifacts }
      : {}),
    ...(opts.resolvedRequest.publishBehavior
      ? { publishBehavior: opts.resolvedRequest.publishBehavior }
      : {}),
    ...(opts.resolvedRequest.parentRunId ? { parentRunId: opts.resolvedRequest.parentRunId } : {}),
    ...(opts.resolvedRequest.releaseLineageId
      ? { releaseLineageId: opts.resolvedRequest.releaseLineageId }
      : {}),
    ...(opts.resolvedRequest.artifactLineageId
      ? { artifactLineageId: opts.resolvedRequest.artifactLineageId }
      : {}),
    ...(opts.resolvedRequest.smokeConnectOverride
      ? { smokeConnectOverride: opts.resolvedRequest.smokeConnectOverride }
      : {}),
    ...(opts.resolvedRequest.source ? { source: opts.resolvedRequest.source } : {}),
    ...(opts.boundary.admissionEvidence
      ? { admissionEvidence: opts.boundary.admissionEvidence }
      : {}),
    ...(opts.governanceResolver ? { governanceResolver: opts.governanceResolver } : {}),
    ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    persistMode: "defer",
  });
  const accepted = await acceptChallengedArtifactSubmission({
    backend: opts.backend,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    request: opts.resolvedRequest,
    proof: opts.resolvedRequest.artifactBindingProof,
    finalizedStagedArtifactReference: finalizedStagedArtifactReference(opts.resolvedRequest),
    principalId: principal.principalId,
    keyId: proofKeyId,
    proofSecret: principal.proofSecret,
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    snapshot: prepared.snapshot,
    submission: prepared.submission,
    refs: {
      submissionPath: prepared.submissionPath,
      executionSnapshotPath: prepared.executionSnapshotPath,
    },
  });
  return submitResponseFromSubmission(accepted.submission as any);
}

export async function acceptChallengedNixosSharedHostSubmitWithRejectedCleanup(
  opts: Parameters<typeof acceptChallengedNixosSharedHostSubmit>[0],
) {
  try {
    return await acceptChallengedNixosSharedHostSubmit(opts);
  } catch (error) {
    return await cleanupThenRethrowRejectedNixosSubmit({
      error,
      request: opts.resolvedRequest,
      paths: opts.paths,
      backend: opts.backend,
      reason: "submit_rejected",
    });
  }
}
