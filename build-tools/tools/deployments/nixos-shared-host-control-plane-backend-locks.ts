#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { sanitizeName } from "../lib/sanitize.ts";
import { queryBackend, readJson } from "./nixos-shared-host-control-plane-backend-db.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db.ts";

type LockAbortReason = "cancelled" | "superseded" | "no_longer_admitted";

type ClaimedQueueEntry = {
  submissionId: string;
  submissionPath: string;
  executionSnapshotPath: string;
  lifecycleState: string;
};

function keyHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function resolveBackendIdempotency(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  kind: "submit" | "run_action";
  key: string;
  requestFingerprint: string;
  targetId: string;
}) {
  const hashedKey = keyHash(opts.key);
  const inserted = (
    await queryBackend<{ target_id: string }>(
      opts.backend,
      `INSERT INTO idempotency (kind, key_hash, request_fingerprint, target_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING target_id`,
      [opts.kind, hashedKey, opts.requestFingerprint, opts.targetId],
    )
  ).rows[0];
  if (inserted?.target_id) {
    return { mode: "created" as const, targetId: inserted.target_id };
  }
  const row = (
    await queryBackend<{ request_fingerprint?: string; target_id?: string }>(
      opts.backend,
      "SELECT request_fingerprint, target_id FROM idempotency WHERE kind = $1 AND key_hash = $2",
      [opts.kind, hashedKey],
    )
  ).rows[0];
  if (!row) {
    throw new Error(`idempotency key ${opts.key} disappeared during lookup`);
  }
  if (row.request_fingerprint !== opts.requestFingerprint) {
    throw new Error(`idempotency key ${opts.key} does not match the previous request`);
  }
  return { mode: "reused" as const, targetId: String(row.target_id || opts.targetId) };
}

export async function syncBackendRunAction(
  backend: NixosSharedHostControlPlaneBackendTarget,
  actionPath: string,
) {
  const doc = await readJson<{ actionId: string; submissionId: string; action: string }>(
    actionPath,
  );
  await queryBackend(
    backend,
    `INSERT INTO run_actions (action_id, submission_id, action, request_json, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT(action_id) DO UPDATE SET
       submission_id = EXCLUDED.submission_id,
       action = EXCLUDED.action,
       request_json = EXCLUDED.request_json,
       updated_at = EXCLUDED.updated_at`,
    [doc.actionId, doc.submissionId, doc.action, JSON.stringify(doc), new Date().toISOString()],
  );
  return doc;
}

export async function claimBackendQueuedSubmission(
  backend: NixosSharedHostControlPlaneBackendTarget,
  workerId: string,
  claimMs = 30_000,
): Promise<ClaimedQueueEntry | null> {
  const now = Date.now();
  const row = (
    await queryBackend<{
      submission_id?: string;
      submission_path?: string;
      execution_snapshot_path?: string;
      lifecycle_state?: string;
    }>(
      backend,
      `WITH candidate AS (
         SELECT q.submission_id
         FROM queue q
         JOIN submissions s ON s.submission_id = q.submission_id
         WHERE q.completed_at IS NULL
           AND (q.claimed_by IS NULL OR q.claim_expires_at IS NULL OR q.claim_expires_at <= $1)
           AND s.lifecycle_state IN ('queued', 'waiting_for_lock')
         ORDER BY q.enqueued_at ASC
         LIMIT 1
       ),
       claimed AS (
         UPDATE queue
         SET claimed_by = $2,
             claim_expires_at = $3
         WHERE submission_id = (SELECT submission_id FROM candidate)
           AND (claimed_by IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= $1)
         RETURNING submission_id
       )
       SELECT claimed.submission_id, s.submission_path, s.execution_snapshot_path, s.lifecycle_state
       FROM claimed
       JOIN submissions s ON s.submission_id = claimed.submission_id`,
      [now, workerId, now + claimMs],
    )
  ).rows[0];
  if (!row?.submission_id || !row.submission_path || !row.execution_snapshot_path) {
    return null;
  }
  return {
    submissionId: row.submission_id,
    submissionPath: row.submission_path,
    executionSnapshotPath: row.execution_snapshot_path,
    lifecycleState: row.lifecycle_state || "queued",
  };
}

export async function acquireBackendControlPlaneLock(
  backend: NixosSharedHostControlPlaneBackendTarget,
  lockScope: string,
  opts?: {
    waitTimeoutMs?: number;
    pollMs?: number;
    shouldAbort?: () => Promise<LockAbortReason | null>;
  },
): Promise<{ fencingToken: string; release: () => Promise<void> }> {
  const holderId = `holder-${sanitizeName(lockScope)}-${process.pid}-${Date.now()}`;
  const fencingToken = `fence-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const deadline = Date.now() + (opts?.waitTimeoutMs ?? 30 * 60_000);
  const pollMs = opts?.pollMs ?? 250;
  const leaseMs = 30_000;
  while (true) {
    const abortReason = await opts?.shouldAbort?.();
    if (abortReason) throw Object.assign(new Error(abortReason), { code: abortReason });
    const now = Date.now();
    const refreshed = (
      await queryBackend<{ lock_scope?: string }>(
        backend,
        `UPDATE locks
         SET holder_id = $2,
             fencing_token = $3,
             lease_expires_at = $4,
             updated_at = $5
         WHERE lock_scope = $1
           AND lease_expires_at <= $6
         RETURNING lock_scope`,
        [lockScope, holderId, fencingToken, now + leaseMs, now, now],
      )
    ).rows[0];
    if (refreshed?.lock_scope) break;
    const inserted = (
      await queryBackend<{ lock_scope?: string }>(
        backend,
        `INSERT INTO locks (lock_scope, holder_id, fencing_token, lease_expires_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING lock_scope`,
        [lockScope, holderId, fencingToken, now + leaseMs, now],
      )
    ).rows[0];
    if (inserted?.lock_scope) break;
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`shared control-plane lock timeout for ${lockScope}`), {
        code: "lock_timeout",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const heartbeat = setInterval(() => {
    const now = Date.now();
    void queryBackend(
      backend,
      `UPDATE locks SET lease_expires_at = $1, updated_at = $2
       WHERE lock_scope = $3 AND holder_id = $4 AND fencing_token = $5`,
      [now + leaseMs, now, lockScope, holderId, fencingToken],
    ).catch(() => {});
  }, 5_000);
  heartbeat.unref?.();
  return {
    fencingToken,
    release: async () => {
      clearInterval(heartbeat);
      await queryBackend(
        backend,
        "DELETE FROM locks WHERE lock_scope = $1 AND holder_id = $2 AND fencing_token = $3",
        [lockScope, holderId, fencingToken],
      );
    },
  };
}
