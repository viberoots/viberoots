#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { DeploymentIdempotencyConflictError } from "./deployment-control-plane-errors.ts";
import {
  decodeBackendJson,
  withBackendClient,
  type BackendQueryable,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db.ts";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract.ts";

export function keyHash(value: string): string {
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

export async function reuseChallengedArtifactSubmissionIfPresent(opts: {
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

export async function readReusableChallengedArtifactSubmission(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  idempotencyKey: string;
  requestFingerprint: string;
}) {
  return await withBackendClient(opts.backend, async (client) => {
    return await reuseChallengedArtifactSubmissionIfPresent({
      client,
      keyHash: keyHash(opts.idempotencyKey),
      requestFingerprint: opts.requestFingerprint,
    });
  });
}
