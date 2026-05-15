#!/usr/bin/env zx-wrapper
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";

export type ControlPlaneWorkerHeartbeatStatus = "starting" | "running" | "stopping" | "stopped";

export async function writeWorkerHeartbeat(
  backend: NixosSharedHostControlPlaneBackendTarget,
  input: { workerId: string; instanceId?: string; status: ControlPlaneWorkerHeartbeatStatus },
) {
  await queryBackend(
    backend,
    `INSERT INTO worker_heartbeats(worker_id, instance_id, status, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT(worker_id) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       status = EXCLUDED.status,
       last_seen_at = EXCLUDED.last_seen_at`,
    [input.workerId, input.instanceId || "unknown", input.status],
  );
}

export async function readWorkerHeartbeats(backend: NixosSharedHostControlPlaneBackendTarget) {
  return (
    await queryBackend<{
      worker_id: string;
      instance_id: string;
      status: string;
      last_seen_at: string;
    }>(
      backend,
      `SELECT worker_id, instance_id, status, last_seen_at
       FROM worker_heartbeats ORDER BY worker_id`,
    )
  ).rows.map((row) => ({
    workerId: row.worker_id,
    instanceId: row.instance_id,
    status: row.status,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function checkControlPlaneReadiness(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  objectStore?: ControlPlaneArtifactStore;
}) {
  await queryBackend(opts.backend, "SELECT 1");
  const artifactStore = opts.objectStore
    ? await checkArtifactStoreReadiness(opts.objectStore)
    : { ok: false, reason: "not_configured" };
  return {
    ok: artifactStore.ok,
    database: { ok: true },
    artifactStore,
    workers: await readWorkerHeartbeats(opts.backend),
  };
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
