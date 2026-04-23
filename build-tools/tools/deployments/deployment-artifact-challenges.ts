#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import {
  artifactBindingEnvelope,
  artifactBindingFingerprint,
  artifactBindingKeyId,
  baseArtifactChallengeRequest,
  verifyArtifactBindingProof,
  type DeploymentArtifactBindingProof,
  type DeploymentArtifactChallengeRequest,
  type DeploymentArtifactChallengeResponse,
} from "./deployment-artifact-binding.ts";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db.ts";

const CHALLENGE_TTL_MS = 2 * 60_000;

type ChallengeRow = {
  challenge_id: string;
  nonce: string;
  expires_at_ms: number;
  used_at?: string | null;
  principal_id: string;
  key_id: string;
  binding_json: unknown;
};

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

export function deploymentServicePrincipalForToken(token?: string): {
  principalId: string;
  keyId: string;
  proofSecret: string;
} {
  const proofSecret = String(token || "local-unprotected-control-plane-fixture");
  return {
    principalId: token ? `service-token:${artifactBindingKeyId(token)}` : "local:unprotected",
    keyId: artifactBindingKeyId(proofSecret),
    proofSecret,
  };
}

export async function createDeploymentArtifactChallenge(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: DeploymentArtifactChallengeRequest;
  principalId: string;
  keyId: string;
}): Promise<DeploymentArtifactChallengeResponse> {
  const challengeId = randomId("artifact-challenge");
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;
  const binding = baseArtifactChallengeRequest(opts.request);
  const bindingFingerprint = artifactBindingFingerprint({
    ...binding,
    principalId: opts.principalId,
    keyId: opts.keyId,
  });
  await queryBackend(
    opts.backend,
    `INSERT INTO artifact_challenges
       (challenge_id, nonce, expires_at_ms, used_at, principal_id, key_id, binding_json)
     VALUES ($1, $2, $3, NULL, $4, $5, $6::jsonb)`,
    [challengeId, nonce, expiresAtMs, opts.principalId, opts.keyId, JSON.stringify(binding)],
  );
  return {
    schemaVersion: "deployment-artifact-challenge@1",
    challengeId,
    nonce,
    expiresAt: new Date(expiresAtMs).toISOString(),
    algorithm: "hmac-sha256",
    keyId: opts.keyId,
    bindingFingerprint,
  };
}

async function readChallenge(
  backend: NixosSharedHostControlPlaneBackendTarget,
  challengeId: string,
): Promise<ChallengeRow> {
  const row = (
    await queryBackend<ChallengeRow>(
      backend,
      "SELECT * FROM artifact_challenges WHERE challenge_id = $1",
      [challengeId],
    )
  ).rows[0];
  if (!row) throw new Error("artifact submission challenge not found");
  return row;
}

export async function consumeDeploymentArtifactChallenge(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: DeploymentArtifactChallengeRequest;
  proof?: DeploymentArtifactBindingProof;
  finalizedStagedArtifactReference?: string;
  principalId: string;
  keyId: string;
  proofSecret: string;
}) {
  if (!opts.proof?.challengeId) throw new Error("artifact submission challenge is required");
  const row = await readChallenge(opts.backend, opts.proof.challengeId);
  if (row.used_at) throw new Error("artifact submission challenge was already used");
  if (Number(row.expires_at_ms) <= Date.now()) {
    throw new Error("artifact submission challenge expired");
  }
  if (row.principal_id !== opts.principalId || row.key_id !== opts.keyId) {
    throw new Error("artifact submission challenge is bound to a different client identity");
  }
  const binding = decodeBackendJson<DeploymentArtifactChallengeRequest>(row.binding_json);
  if (
    artifactBindingFingerprint(binding) !==
    artifactBindingFingerprint(baseArtifactChallengeRequest(opts.request))
  ) {
    throw new Error("artifact submission challenge does not match this request");
  }
  verifyArtifactBindingProof({
    proof: opts.proof,
    secret: opts.proofSecret,
    envelope: artifactBindingEnvelope({
      request: binding,
      principalId: opts.principalId,
      keyId: opts.keyId,
      challengeId: row.challenge_id,
      nonce: row.nonce,
      finalizedStagedArtifactReference: opts.finalizedStagedArtifactReference,
    }),
  });
  const consumed = (
    await queryBackend<{ challenge_id?: string }>(
      opts.backend,
      `UPDATE artifact_challenges
       SET used_at = $2
       WHERE challenge_id = $1
         AND used_at IS NULL
       RETURNING challenge_id`,
      [row.challenge_id, new Date().toISOString()],
    )
  ).rows[0];
  if (!consumed?.challenge_id) {
    throw new Error("artifact submission challenge was already used");
  }
  return {
    challengeId: row.challenge_id,
    keyId: row.key_id,
    canonicalPayloadFingerprint: opts.proof.canonicalPayloadFingerprint,
  };
}
