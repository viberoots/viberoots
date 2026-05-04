#!/usr/bin/env zx-wrapper
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";

type BackendTarget = {
  recordsRoot: string;
  databaseUrl: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readQueueClaimExpiry(backend: BackendTarget, submissionId: string) {
  const row = (
    await queryBackend<{ claim_expires_at?: number }>(
      backend,
      "SELECT claim_expires_at FROM queue WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  return Number(row?.claim_expires_at || 0);
}

export async function waitForClaimRenewal(
  backend: BackendTarget,
  submissionId: string,
  previousExpiry: number,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const currentExpiry = await readQueueClaimExpiry(backend, submissionId);
    if (currentExpiry > previousExpiry) return currentExpiry;
    await sleep(25);
  }
  throw new Error(`claim lease did not renew for ${submissionId}`);
}
