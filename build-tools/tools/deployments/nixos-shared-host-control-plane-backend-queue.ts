#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

type ClaimedQueueRow = {
  submissionId: string;
  submissionPath: string;
  executionSnapshotPath: string;
  lifecycleState: string;
  claimToken: string;
};

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function claimLeaseMs(): number {
  return envInt("BNX_DEPLOY_CONTROL_PLANE_CLAIM_LEASE_MS", 30_000);
}

function claimHeartbeatMs(): number {
  return envInt("BNX_DEPLOY_CONTROL_PLANE_CLAIM_HEARTBEAT_MS", 5_000);
}

async function renewBackendSubmissionClaim(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionId: string;
  workerId: string;
  claimToken: string;
  claimMs: number;
}) {
  const now = Date.now();
  const row = (
    await queryBackend<{ submission_id?: string }>(
      opts.backend,
      `UPDATE queue
       SET claim_expires_at = $1
       WHERE submission_id = $2
         AND claimed_by = $3
         AND claim_token = $4
         AND completed_at IS NULL
         AND (claim_expires_at IS NULL OR claim_expires_at > $5)
       RETURNING submission_id`,
      [now + opts.claimMs, opts.submissionId, opts.workerId, opts.claimToken, now],
    )
  ).rows[0];
  return row?.submission_id === opts.submissionId;
}

export async function claimBackendQueuedSubmission(
  backend: NixosSharedHostControlPlaneBackendTarget,
  workerId: string,
  claimMs = claimLeaseMs(),
): Promise<ClaimedQueueRow | null> {
  const now = Date.now();
  const claimToken = `claim-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const row = (
    await queryBackend<{
      submission_id?: string;
      submission_path?: string;
      execution_snapshot_path?: string;
      lifecycle_state?: string;
      claim_token?: string;
    }>(
      backend,
      `WITH candidate AS (
         SELECT q.submission_id
         FROM queue q
         JOIN submissions s ON s.submission_id = q.submission_id
         WHERE q.completed_at IS NULL
           AND (q.claimed_by IS NULL OR q.claim_expires_at IS NULL OR q.claim_expires_at <= $1)
           AND s.lifecycle_state IN ('queued', 'waiting_for_lock', 'running', 'cancelling')
         ORDER BY q.enqueued_at ASC
         LIMIT 1
       ),
       claimed AS (
         UPDATE queue
         SET claimed_by = $2,
             claim_token = $3,
             claim_expires_at = $4
         WHERE submission_id = (SELECT submission_id FROM candidate)
           AND (claimed_by IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= $1)
         RETURNING submission_id, claim_token
       )
       SELECT claimed.submission_id, claimed.claim_token, s.submission_path,
              s.execution_snapshot_path, s.lifecycle_state
       FROM claimed
       JOIN submissions s ON s.submission_id = claimed.submission_id`,
      [now, workerId, claimToken, now + claimMs],
    )
  ).rows[0];
  if (
    !row?.submission_id ||
    !row.submission_path ||
    !row.execution_snapshot_path ||
    !row.claim_token
  ) {
    return null;
  }
  return {
    submissionId: row.submission_id,
    submissionPath: row.submission_path,
    executionSnapshotPath: row.execution_snapshot_path,
    lifecycleState: row.lifecycle_state || "queued",
    claimToken: row.claim_token,
  };
}

export function startBackendSubmissionClaimLease(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionId: string;
  workerId: string;
  claimToken: string;
  claimMs?: number;
  heartbeatMs?: number;
}) {
  const claimMs = opts.claimMs ?? claimLeaseMs();
  const heartbeatMs = opts.heartbeatMs ?? claimHeartbeatMs();
  let stopped = false;
  const refresh = async () =>
    await renewBackendSubmissionClaim({
      backend: opts.backend,
      submissionId: opts.submissionId,
      workerId: opts.workerId,
      claimToken: opts.claimToken,
      claimMs,
    });
  const heartbeat = setInterval(
    () => {
      if (stopped) return;
      void refresh().catch(() => {});
    },
    Math.max(25, heartbeatMs),
  );
  heartbeat.unref?.();
  return {
    assertCurrentAuthority: async () => {
      if (!(await refresh())) {
        throw Object.assign(
          new Error(`shared control-plane worker ownership lost for ${opts.submissionId}`),
          { code: "worker_ownership_lost" },
        );
      }
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeat);
    },
  };
}
