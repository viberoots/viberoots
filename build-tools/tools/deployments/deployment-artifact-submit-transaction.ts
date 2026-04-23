#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import {
  type DeploymentArtifactBindingProof,
  type DeploymentArtifactChallengeRequest,
} from "./deployment-artifact-binding.ts";
import {
  admittedArtifactBindingIdentities,
  admittedStoredArtifactReference,
  verifyArtifactChallengeForSubmit,
  type ArtifactChallengeRow,
} from "./deployment-artifact-submit-provenance.ts";
import { DeploymentIdempotencyConflictError } from "./deployment-control-plane-errors.ts";
import {
  decodeBackendJson,
  withBackendClient,
  type BackendQueryable,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db.ts";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";

function keyHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readExistingSubmission(
  client: BackendQueryable,
  submissionId: string,
): Promise<NixosSharedHostControlPlaneSubmission> {
  const row = (
    await client.query<{ document_json?: unknown }>(
      "SELECT document_json FROM submissions WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  if (!row?.document_json) {
    throw new Error(`idempotent submission missing backend state: ${submissionId}`);
  }
  return decodeBackendJson<NixosSharedHostControlPlaneSubmission>(row.document_json);
}

async function reuseIfPresent(opts: {
  client: BackendQueryable;
  keyHash: string;
  requestFingerprint: string;
}) {
  const row = (
    await opts.client.query<{ request_fingerprint?: string; target_id?: string }>(
      "SELECT request_fingerprint, target_id FROM idempotency WHERE kind = $1 AND key_hash = $2",
      ["submit", opts.keyHash],
    )
  ).rows[0];
  if (!row) return null;
  if (row.request_fingerprint !== opts.requestFingerprint) {
    throw new DeploymentIdempotencyConflictError(
      "submit idempotency key does not match the previous request",
    );
  }
  return await readExistingSubmission(opts.client, String(row.target_id));
}

async function assertSubmissionSlotsFree(client: BackendQueryable, submissionId: string) {
  const [snapshots, submissions, queue] = await Promise.all([
    client.query("SELECT submission_id FROM snapshots WHERE submission_id = $1", [submissionId]),
    client.query("SELECT submission_id FROM submissions WHERE submission_id = $1", [submissionId]),
    client.query("SELECT submission_id FROM queue WHERE submission_id = $1", [submissionId]),
  ]);
  if (snapshots.rows[0] || submissions.rows[0] || queue.rows[0]) {
    throw new Error(`accepted submission state already exists for ${submissionId}`);
  }
}

async function persistAccepted(opts: {
  client: BackendQueryable;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  submission: NixosSharedHostControlPlaneSubmission;
  refs: { submissionPath: string; executionSnapshotPath: string };
}) {
  const now = new Date().toISOString();
  await opts.client.query(
    `INSERT INTO snapshots (submission_id, execution_snapshot_path, document_json, updated_at)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [
      opts.snapshot.submissionId,
      opts.refs.executionSnapshotPath,
      JSON.stringify(opts.snapshot),
      now,
    ],
  );
  await opts.client.query(
    `INSERT INTO submissions (
       submission_id, submission_path, execution_snapshot_path, lock_scope, lifecycle_state,
       deploy_run_id, completed_at, document_json, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, $8)`,
    [
      opts.submission.submissionId,
      opts.refs.submissionPath,
      opts.refs.executionSnapshotPath,
      opts.submission.lockScope,
      opts.submission.lifecycleState,
      opts.submission.deployRunId || null,
      JSON.stringify(opts.submission),
      now,
    ],
  );
  await opts.client.query(
    `INSERT INTO queue (
       submission_id, enqueued_at, claimed_by, claim_token, claim_expires_at, completed_at
     ) VALUES ($1, $2, NULL, NULL, NULL, NULL)`,
    [opts.submission.submissionId, opts.submission.submittedAt],
  );
}

export async function acceptChallengedArtifactSubmission(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  idempotencyKey: string;
  requestFingerprint: string;
  request: DeploymentArtifactChallengeRequest;
  proof?: DeploymentArtifactBindingProof;
  finalizedStagedArtifactReference?: string;
  principalId: string;
  keyId: string;
  proofSecret: string;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  submission: NixosSharedHostControlPlaneSubmission;
  refs: { submissionPath: string; executionSnapshotPath: string };
}) {
  return await withBackendClient(opts.backend, async (client) => {
    await client.query("BEGIN");
    let insertedKeyHash: string | undefined;
    let consumedChallenge: { id: string; usedAt: string } | undefined;
    try {
      const hashedKey = keyHash(opts.idempotencyKey);
      const reused = await reuseIfPresent({
        client,
        keyHash: hashedKey,
        requestFingerprint: opts.requestFingerprint,
      });
      if (reused) {
        await client.query("COMMIT");
        return { mode: "reused" as const, submission: reused };
      }
      if (!opts.proof?.challengeId) {
        throw new Error("artifact submission challenge is required");
      }
      const row = (
        await client.query<ArtifactChallengeRow>(
          "SELECT * FROM artifact_challenges WHERE challenge_id = $1",
          [opts.proof.challengeId],
        )
      ).rows[0];
      if (!row) throw new Error("artifact submission challenge not found");
      const verifiedAt = new Date().toISOString();
      const provenance = verifyArtifactChallengeForSubmit({ ...opts, row, verifiedAt });
      await assertSubmissionSlotsFree(client, opts.submission.submissionId);
      const inserted = (
        await client.query<{ target_id?: string }>(
          `INSERT INTO idempotency (kind, key_hash, request_fingerprint, target_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING target_id`,
          ["submit", hashedKey, opts.requestFingerprint, opts.submission.submissionId],
        )
      ).rows[0];
      if (!inserted?.target_id) {
        const raced = await reuseIfPresent({
          client,
          keyHash: hashedKey,
          requestFingerprint: opts.requestFingerprint,
        });
        if (raced) {
          await client.query("COMMIT");
          return { mode: "reused" as const, submission: raced };
        }
        throw new Error("submit idempotency state disappeared during challenged accept");
      }
      insertedKeyHash = hashedKey;
      const consumed = (
        await client.query<{ challenge_id?: string }>(
          `UPDATE artifact_challenges
           SET used_at = $2
           WHERE challenge_id = $1 AND used_at IS NULL
           RETURNING challenge_id`,
          [row.challenge_id, verifiedAt],
        )
      ).rows[0];
      if (!consumed?.challenge_id) {
        throw new Error("artifact submission challenge was already used");
      }
      consumedChallenge = { id: row.challenge_id, usedAt: verifiedAt };
      const submission = {
        ...opts.submission,
        lifecycleState: "waiting_for_lock" as const,
        artifactBinding: {
          ...provenance,
          admittedIdentities: admittedArtifactBindingIdentities(opts.snapshot),
          admittedStoredArtifactReference: admittedStoredArtifactReference(opts.snapshot),
        },
      };
      await persistAccepted({ ...opts, client, submission });
      await client.query("COMMIT");
      return { mode: "created" as const, submission };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (consumedChallenge) {
        await client
          .query(
            "UPDATE artifact_challenges SET used_at = NULL WHERE challenge_id = $1 AND used_at = $2",
            [consumedChallenge.id, consumedChallenge.usedAt],
          )
          .catch(() => {});
      }
      if (insertedKeyHash) {
        await Promise.all([
          client.query("DELETE FROM queue WHERE submission_id = $1", [
            opts.submission.submissionId,
          ]),
          client.query("DELETE FROM submissions WHERE submission_id = $1", [
            opts.submission.submissionId,
          ]),
          client.query("DELETE FROM snapshots WHERE submission_id = $1", [
            opts.submission.submissionId,
          ]),
          client.query("DELETE FROM idempotency WHERE kind = $1 AND key_hash = $2", [
            "submit",
            insertedKeyHash,
          ]),
        ]).catch(() => {});
      }
      throw error;
    }
  });
}
