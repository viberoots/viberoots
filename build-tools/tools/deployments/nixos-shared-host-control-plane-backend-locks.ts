#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { sanitizeName } from "../lib/sanitize";
import { queryBackend, readJson } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

type LockAbortReason = "cancelled" | "superseded" | "no_longer_admitted";

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
  await writeBackendRunActionDoc(backend, doc);
  return doc;
}

export async function writeBackendRunActionDoc(
  backend: NixosSharedHostControlPlaneBackendTarget,
  doc: { actionId: string; submissionId: string; action: string },
) {
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

export async function acquireBackendControlPlaneLock(
  backend: NixosSharedHostControlPlaneBackendTarget,
  lockScope: string,
  opts?: {
    waitTimeoutMs?: number;
    pollMs?: number;
    shouldAbort?: () => Promise<LockAbortReason | null>;
  },
): Promise<{
  fencingToken: string;
  assertCurrentAuthority: () => Promise<void>;
  release: () => Promise<void>;
}> {
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
    assertCurrentAuthority: async () => {
      const now = Date.now();
      const row = (
        await queryBackend<{ lock_scope?: string }>(
          backend,
          `SELECT lock_scope FROM locks
           WHERE lock_scope = $1
             AND holder_id = $2
             AND fencing_token = $3
             AND lease_expires_at > $4`,
          [lockScope, holderId, fencingToken, now],
        )
      ).rows[0];
      if (row?.lock_scope !== lockScope) {
        throw Object.assign(
          new Error(`shared control-plane lock ownership lost for ${lockScope}`),
          {
            code: "lock_ownership_lost",
          },
        );
      }
    },
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
