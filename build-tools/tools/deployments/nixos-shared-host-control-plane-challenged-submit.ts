#!/usr/bin/env zx-wrapper
import { acceptChallengedArtifactSubmission } from "./deployment-artifact-submit-transaction.ts";
import { readReusableChallengedArtifactSubmission } from "./deployment-artifact-submit-idempotency.ts";
import {
  deploymentServicePrincipalForToken,
  verifyDeploymentArtifactChallenge,
} from "./deployment-artifact-challenges.ts";
import { submitResponseFromSubmission } from "./deployment-control-plane-status.ts";
import { prepareBackendNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-backend-prepare.ts";
import type { DeploymentControlPlaneAuthorizationDecision } from "./deployment-control-plane-contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";

type Boundary = {
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  admissionEvidence?: DeploymentAdmissionEvidence;
};

function finalizedArtifactReference(request: NixosSharedHostControlPlaneSubmitRequest) {
  return request.artifactDir || JSON.stringify(request.artifactDirsByComponentId);
}

function assertArtifactSubmissionHasExpectedIdentity(
  request: NixosSharedHostControlPlaneSubmitRequest,
) {
  if (!request.artifactDir && !request.artifactDirsByComponentId) {
    return;
  }
  if (!request.expectedArtifactIdentity && !request.expectedComponentArtifactIdentities) {
    throw new Error("protected/shared artifact submit requires expected artifact identity");
  }
}

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
}) {
  assertArtifactSubmissionHasExpectedIdentity(opts.resolvedRequest);
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
    finalizedStagedArtifactReference: finalizedArtifactReference(opts.resolvedRequest),
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
    persistMode: "defer",
  });
  const accepted = await acceptChallengedArtifactSubmission({
    backend: opts.backend,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    request: opts.resolvedRequest,
    proof: opts.resolvedRequest.artifactBindingProof,
    finalizedStagedArtifactReference: finalizedArtifactReference(opts.resolvedRequest),
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
