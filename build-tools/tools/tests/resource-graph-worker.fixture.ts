#!/usr/bin/env zx-wrapper
import { queryBackend } from "../deployments/nixos-shared-host-control-plane-backend-db";

export async function seedWorkerEvidenceRows(backend: {
  recordsRoot: string;
  databaseUrl: string;
}) {
  const nowMs = Date.now();
  await queryBackend(backend, `INSERT INTO queue VALUES ($1,$2,$3,$4,$5,NULL)`, [
    "submission-1",
    new Date(nowMs - 10_000).toISOString(),
    "worker-1",
    "claim-token-1",
    nowMs + 600_000,
  ]);
  await queryBackend(backend, `INSERT INTO worker_heartbeats VALUES ($1,$2,$3,$4,$5::jsonb)`, [
    "worker-1",
    "instance-1",
    "running",
    new Date(nowMs - 10_000).toISOString(),
    JSON.stringify({ supportedExecutionModes: ["deployment-control-plane"], token: "raw-secret" }),
  ]);
}
