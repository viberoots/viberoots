#!/usr/bin/env zx-wrapper
import { queryBackend } from "../deployments/nixos-shared-host-control-plane-backend-db";

export async function seedWorkerEvidenceRows(backend: {
  recordsRoot: string;
  databaseUrl: string;
}) {
  await queryBackend(backend, `INSERT INTO queue VALUES ($1,$2,$3,$4,$5,NULL)`, [
    "submission-1",
    "2026-07-05T12:00:00.000Z",
    "worker-1",
    "claim-token-1",
    Date.parse("2026-07-05T12:10:00.000Z"),
  ]);
  await queryBackend(backend, `INSERT INTO worker_heartbeats VALUES ($1,$2,$3,$4,$5::jsonb)`, [
    "worker-1",
    "instance-1",
    "running",
    "2026-07-05T12:00:00.000Z",
    JSON.stringify({ supportedExecutionModes: ["deployment-control-plane"], token: "raw-secret" }),
  ]);
}
