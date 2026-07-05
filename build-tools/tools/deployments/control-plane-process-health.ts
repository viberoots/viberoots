#!/usr/bin/env zx-wrapper
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import {
  readWorkerEvidence,
  workerHeartbeatProbeEvidence,
  type WorkerEvidence,
} from "./control-plane-worker-evidence";

export type ControlPlaneWorkerHeartbeatStatus = "starting" | "running" | "stopping" | "stopped";

export async function writeWorkerHeartbeat(
  backend: NixosSharedHostControlPlaneBackendTarget,
  input: { workerId: string; instanceId?: string; status: ControlPlaneWorkerHeartbeatStatus },
) {
  await queryBackend(
    backend,
    `INSERT INTO worker_heartbeats(worker_id, instance_id, status, last_seen_at, evidence_json)
     VALUES ($1, $2, $3, NOW(), $4::jsonb)
     ON CONFLICT(worker_id) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       status = EXCLUDED.status,
       last_seen_at = EXCLUDED.last_seen_at,
       evidence_json = EXCLUDED.evidence_json`,
    [
      input.workerId,
      input.instanceId || "unknown",
      input.status,
      JSON.stringify({
        supportedExecutionModes: ["deployment-control-plane"],
      }),
    ],
  );
}

export async function readWorkerHeartbeats(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { expectedInstanceId?: string } = {},
): Promise<WorkerEvidence[]> {
  return await readWorkerEvidence(backend, opts);
}

export async function readWorkerHeartbeatProbe(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { expectedInstanceId?: string } = {},
) {
  return workerHeartbeatProbeEvidence(await readWorkerHeartbeats(backend, opts));
}

export async function checkControlPlaneReadiness(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  objectStore?: ControlPlaneArtifactStore;
  runtimeConfig?: { publicUrl?: string; profileIdentity?: string };
}) {
  const database = await checkDatabaseReadiness(opts.backend);
  const artifactStore = opts.objectStore
    ? await checkArtifactStoreReadiness(opts.objectStore)
    : { ok: false, reason: "not_configured" };
  const workers = database.ok ? await readWorkerHeartbeats(opts.backend) : [];
  const workerQueueLocks = database.ok
    ? await checkWorkerQueueLocksReadiness(opts.backend)
    : { ok: false, reason: "database_unavailable" };
  return {
    ok: database.ok && artifactStore.ok && workerQueueLocks.ok,
    database,
    artifactStore,
    workerQueueLocks,
    runtimeConfig: { ok: true, ...(opts.runtimeConfig || {}) },
    workers,
  };
}

async function checkDatabaseReadiness(backend: NixosSharedHostControlPlaneBackendTarget) {
  try {
    await queryBackend(backend, "SELECT 1");
    return { ok: true };
  } catch {
    return { ok: false, reason: "connectivity_check_failed" };
  }
}

async function checkArtifactStoreReadiness(store: ControlPlaneArtifactStore) {
  try {
    await store.getObjectMetadata({ key: "control-plane/.health" });
    return { ok: true, bucket: store.bucket };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/missing|not found|404|NoSuchKey/i.test(message)) {
      return { ok: true, bucket: store.bucket };
    }
    return { ok: false, bucket: store.bucket, reason: "metadata_check_failed" };
  }
}

async function checkWorkerQueueLocksReadiness(backend: NixosSharedHostControlPlaneBackendTarget) {
  try {
    await queryBackend(
      backend,
      "SELECT (SELECT COUNT(*) FROM queue) AS queue_count, (SELECT COUNT(*) FROM locks) AS lock_count",
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "queue_or_locks_check_failed" };
  }
}
