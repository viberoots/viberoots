#!/usr/bin/env zx-wrapper
import {
  artifactBindingEnvelope,
  expectedFields,
  verifyArtifactBindingProof,
  type DeploymentArtifactBindingProof,
  type DeploymentArtifactBindingProvenance,
  type DeploymentArtifactChallengeRequest,
  type DeploymentExpectedArtifactIdentities,
} from "./deployment-artifact-binding";
import {
  assertArtifactChallengeBindingMatches,
  decodeArtifactChallengeBinding,
} from "./deployment-artifact-challenge-binding";
import {
  assertDeploymentArtifactProofKeyActive,
  defaultDeploymentArtifactProofKeyRegistry,
  type DeploymentArtifactProofKeyRegistry,
} from "./deployment-artifact-proof-keys";
import { decodeBackendJson } from "./nixos-shared-host-control-plane-backend-db";
import type { DeploymentControlPlaneAuthorizationDecision } from "./deployment-control-plane-contract";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import { finalizedStagedArtifactReference } from "./nixos-shared-host-artifact-submit-request";

export type ArtifactChallengeRow = {
  challenge_id: string;
  nonce: string;
  expires_at_ms: number;
  used_at?: string | null;
  principal_id: string;
  key_id: string;
  binding_json: unknown;
};

export function admittedArtifactBindingIdentities(
  snapshot: NixosSharedHostControlPlaneSnapshot,
): DeploymentExpectedArtifactIdentities {
  const publishInput = snapshot.action.kind === "deploy" ? snapshot.action.publishInput : undefined;
  if (!publishInput) return {};
  if (publishInput.kind === "exact-artifact") {
    return { expectedArtifactIdentity: publishInput.artifact.identity };
  }
  return {
    expectedCompositeArtifactIdentity: publishInput.compositeArtifactIdentity,
    expectedComponentArtifactIdentities: Object.fromEntries(
      publishInput.components.map((entry) => [entry.componentId, entry.artifact.identity]),
    ),
  };
}

export function admittedStoredArtifactReference(
  snapshot: NixosSharedHostControlPlaneSnapshot,
): string | undefined {
  const publishInput = snapshot.action.kind === "deploy" ? snapshot.action.publishInput : undefined;
  if (!publishInput) return undefined;
  if (publishInput.kind === "exact-artifact") return `artifact:${publishInput.artifact.identity}`;
  return `artifact:${publishInput.compositeArtifactIdentity}`;
}

export function verifyArtifactChallengeForSubmit(opts: {
  row: ArtifactChallengeRow;
  request: DeploymentArtifactChallengeRequest;
  proof?: DeploymentArtifactBindingProof;
  finalizedStagedArtifactReference?: string;
  principalId: string;
  keyId: string;
  proofSecret: string;
  proofKeyRegistry?: DeploymentArtifactProofKeyRegistry;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  verifiedAt: string;
}): DeploymentArtifactBindingProvenance {
  if (!opts.proof?.challengeId) throw new Error("artifact submission challenge is required");
  if (opts.row.used_at) throw new Error("artifact submission challenge was already used");
  if (Number(opts.row.expires_at_ms) <= Date.now()) {
    throw new Error("artifact submission challenge expired");
  }
  if (opts.row.principal_id !== opts.principalId || opts.row.key_id !== opts.keyId) {
    throw new Error("artifact submission challenge is bound to a different client identity");
  }
  assertDeploymentArtifactProofKeyActive({
    registry:
      opts.proofKeyRegistry ||
      defaultDeploymentArtifactProofKeyRegistry({
        principalId: opts.principalId,
        keyId: opts.keyId,
      }),
    keyId: opts.row.key_id,
    principalId: opts.principalId,
  });
  const binding = decodeArtifactChallengeBinding(decodeBackendJson(opts.row.binding_json));
  assertArtifactChallengeBindingMatches({
    stored: binding,
    request: opts.request,
    finalizedStagedArtifactReference:
      opts.finalizedStagedArtifactReference ||
      finalizedStagedArtifactReference(opts.request as any),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
  });
  verifyArtifactBindingProof({
    proof: opts.proof,
    secret: opts.proofSecret,
    envelope: artifactBindingEnvelope({
      request: binding.request,
      principalId: opts.principalId,
      keyId: opts.keyId,
      challengeId: opts.row.challenge_id,
      nonce: opts.row.nonce,
      finalizedStagedArtifactReference: opts.finalizedStagedArtifactReference,
    }),
  });
  return {
    challengeId: opts.row.challenge_id,
    principalId: opts.principalId,
    keyId: opts.keyId,
    proofAlgorithm: opts.proof.algorithm,
    canonicalEnvelopeFingerprint: opts.proof.canonicalPayloadFingerprint,
    expectedIdentities: expectedFields(opts.request),
    admittedIdentities: {},
    verificationDecision: "accepted",
    verifiedAt: opts.verifiedAt,
  };
}
