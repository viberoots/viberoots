#!/usr/bin/env zx-wrapper
import { redactControlPlaneReadModel } from "./deployment-control-plane-read-redaction";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

export const WORKER_EVIDENCE_SCHEMA = "control-plane-worker-evidence@1";
const DEFAULT_STALE_AFTER_MS = 30_000;

export type WorkerHealth = "healthy" | "expired" | "missing" | "mismatched-authority";

export type WorkerEvidence = {
  schemaVersion: typeof WORKER_EVIDENCE_SCHEMA;
  workerId: string;
  instanceId: string;
  status: string;
  lastSeenAt?: string;
  controlPlaneAssociation: { instanceId: string; expectedInstanceId?: string; authority: string };
  supportedExecutionModes: string[];
  health: { status: WorkerHealth; heartbeatStatus: string; lastSeenAt?: string; ageMs?: number };
  leaseClaims: WorkerLeaseClaim[];
  diagnosticOnly: true;
  authorizesWork: false;
  authorityBoundary: string;
};

export type WorkerLeaseClaim = {
  submissionId: string;
  deployRunId?: string;
  executionSnapshotPath: string;
  claimState: "active" | "expired";
  claimExpiresAt?: number;
};

type HeartbeatRow = {
  worker_id: string;
  instance_id: string;
  status: string;
  last_seen_at: unknown;
  evidence_json?: unknown;
};

type ClaimRow = {
  worker_id: string;
  submission_id: string;
  deploy_run_id?: string | null;
  execution_snapshot_path: string;
  claim_expires_at?: number | null;
};

export async function readWorkerEvidence(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { expectedWorkerIds?: string[]; expectedInstanceId?: string; nowMs?: number } = {},
) {
  const [heartbeats, claims] = await Promise.all([
    queryBackend<HeartbeatRow>(
      backend,
      `SELECT worker_id, instance_id, status, last_seen_at, evidence_json
       FROM worker_heartbeats ORDER BY worker_id`,
    ),
    queryBackend<ClaimRow>(
      backend,
      `SELECT q.claimed_by AS worker_id, q.submission_id, s.deploy_run_id,
              s.execution_snapshot_path, q.claim_expires_at
       FROM queue q
       JOIN submissions s ON s.submission_id = q.submission_id
       WHERE q.claimed_by IS NOT NULL
       ORDER BY q.claimed_by, q.submission_id`,
    ),
  ]);
  return buildWorkerEvidence({
    heartbeats: heartbeats.rows,
    claims: claims.rows,
    expectedWorkerIds: opts.expectedWorkerIds || [],
    expectedInstanceId: opts.expectedInstanceId,
    nowMs: opts.nowMs,
  });
}

export function buildWorkerEvidence(opts: {
  heartbeats: HeartbeatRow[];
  claims?: ClaimRow[];
  expectedWorkerIds?: string[];
  expectedInstanceId?: string;
  nowMs?: number;
  staleAfterMs?: number;
}) {
  const nowMs = opts.nowMs ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const claimsByWorker = groupClaims(opts.claims || []);
  const rows = new Map(opts.heartbeats.map((row) => [row.worker_id, row]));
  for (const workerId of opts.expectedWorkerIds || []) {
    if (!rows.has(workerId)) rows.set(workerId, missingHeartbeat(workerId));
  }
  return redactControlPlaneReadModel(
    [...rows.values()].map((row) =>
      workerEvidenceFor(row, claimsByWorker.get(row.worker_id) || [], {
        nowMs,
        staleAfterMs,
        expectedInstanceId: opts.expectedInstanceId,
      }),
    ),
  );
}

export function workerHeartbeatProbeEvidence(workers: WorkerEvidence[]) {
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-worker-heartbeat-probe@1",
    evidenceKind: "runtime-http-worker-heartbeats",
    ok: workers.every((worker) => worker.health.status === "healthy"),
    workers,
  });
}

function workerEvidenceFor(
  row: HeartbeatRow,
  claims: ClaimRow[],
  opts: { nowMs: number; staleAfterMs: number; expectedInstanceId?: string },
): WorkerEvidence {
  const lastSeenAt = timestampString(row.last_seen_at);
  const ageMs = lastSeenAt ? Math.max(0, opts.nowMs - Date.parse(lastSeenAt)) : undefined;
  const metadata = decodeMetadata(row.evidence_json);
  const authority = authorityFor(row.instance_id, opts.expectedInstanceId);
  return {
    schemaVersion: WORKER_EVIDENCE_SCHEMA,
    workerId: row.worker_id,
    instanceId: row.instance_id,
    status: row.status,
    ...(lastSeenAt ? { lastSeenAt } : {}),
    controlPlaneAssociation: {
      instanceId: row.instance_id,
      ...(opts.expectedInstanceId ? { expectedInstanceId: opts.expectedInstanceId } : {}),
      authority,
    },
    supportedExecutionModes: metadata.supportedExecutionModes || ["deployment-control-plane"],
    health: {
      status: healthFor(row.status, ageMs, opts.staleAfterMs, authority),
      heartbeatStatus: row.status,
      ...(lastSeenAt ? { lastSeenAt } : {}),
      ...(ageMs !== undefined ? { ageMs } : {}),
    },
    leaseClaims: claims.map((claim) => claimEvidence(claim, opts.nowMs)),
    diagnosticOnly: true,
    authorizesWork: false,
    authorityBoundary: "queue claim, current lease, and provider fencing token remain required",
  };
}

function healthFor(
  status: string,
  ageMs: number | undefined,
  staleAfterMs: number,
  authority: string,
) {
  if (status === "missing") return "missing";
  if (authority === "mismatched") return "mismatched-authority";
  if (ageMs !== undefined && ageMs > staleAfterMs) return "expired";
  return "healthy";
}

function claimEvidence(row: ClaimRow, nowMs: number): WorkerLeaseClaim {
  const expiresAt = Number(row.claim_expires_at || 0) || undefined;
  return {
    submissionId: row.submission_id,
    ...(row.deploy_run_id ? { deployRunId: row.deploy_run_id } : {}),
    executionSnapshotPath: row.execution_snapshot_path,
    claimState: expiresAt && expiresAt > nowMs ? "active" : "expired",
    ...(expiresAt ? { claimExpiresAt: expiresAt } : {}),
  };
}

function authorityFor(instanceId: string, expectedInstanceId?: string) {
  if (!expectedInstanceId) return "observed";
  return instanceId === expectedInstanceId ? "matched" : "mismatched";
}

function groupClaims(rows: ClaimRow[]) {
  const grouped = new Map<string, ClaimRow[]>();
  for (const row of rows) grouped.set(row.worker_id, [...(grouped.get(row.worker_id) || []), row]);
  return grouped;
}

function decodeMetadata(value: unknown): { supportedExecutionModes?: string[] } {
  if (!value) return {};
  const decoded = decodeBackendJson<Record<string, unknown>>(value);
  const modes = Array.isArray(decoded.supportedExecutionModes)
    ? decoded.supportedExecutionModes.map(String)
    : undefined;
  return modes ? { supportedExecutionModes: modes } : {};
}

function missingHeartbeat(workerId: string): HeartbeatRow {
  return { worker_id: workerId, instance_id: "unknown", status: "missing", last_seen_at: "" };
}

function timestampString(value: unknown): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}
