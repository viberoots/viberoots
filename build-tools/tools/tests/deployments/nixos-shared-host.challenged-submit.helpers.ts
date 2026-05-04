#!/usr/bin/env zx-wrapper
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

export async function challengedSubmitRequest(artifactDir: string, idempotencyKey: string) {
  const deployment = nixosSharedHostDeploymentFixture();
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createNixosSharedHostSubmissionId(),
    submittedAt: new Date().toISOString(),
    deployment,
    operationKind: "deploy",
    idempotencyKey,
    artifactDir,
    ...(await expectedNixosSharedHostArtifactIdentities({ deployment, artifactDir })),
    admissionEvidence: serviceSubmissionAdmissionEvidence(
      reviewedLaneAdmissionEvidenceFixture({ deployment }),
    ),
  };
}

export function challengedSubmitProof(request: any, challenge: any, token?: string) {
  const principal = deploymentServicePrincipalForToken(token);
  return createArtifactBindingProof(
    artifactBindingEnvelope({
      request,
      principalId: principal.principalId,
      keyId: challenge.keyId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      finalizedStagedArtifactReference: request.artifactDir,
    }),
    principal.proofSecret,
  );
}

export async function countBackendRows(backend: any, table: string, where = "TRUE") {
  const row = (
    await queryBackend<any>(backend, `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
  ).rows[0];
  return Number(row?.count || 0);
}
