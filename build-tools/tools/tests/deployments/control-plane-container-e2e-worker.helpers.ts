#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import {
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  startBackendSubmissionClaimLease,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedWorkerSubmission(tmp: string, submissionId: string) {
  const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
  const snapshotPath = path.join(tmp, "snapshots", `${submissionId}.json`);
  const submissionPath = path.join(tmp, "submissions", `${submissionId}.json`);
  await writeBackendSnapshotDoc(
    backend,
    {
      submissionId,
      submittedAt: "2026-05-15T12:00:00.000Z",
      operationKind: "deploy",
      deploymentId: "cloud-control-fixture-staging-s3",
      lockScope: "s3-static:cloud-control-fixture/cloud-control-fixture-staging-site",
    },
    snapshotPath,
  );
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId,
      submittedAt: "2026-05-15T12:00:00.000Z",
      deploymentId: "cloud-control-fixture-staging-s3",
      operationKind: "deploy",
      lockScope: "s3-static:cloud-control-fixture/cloud-control-fixture-staging-site",
      executionSnapshotPath: snapshotPath,
      lifecycleState: "waiting_for_lock",
      dedupe: { idempotencyKey: submissionId },
    },
    { submissionPath, executionSnapshotPath: snapshotPath },
  );
  await enqueueBackendSubmission(backend, submissionId, "2026-05-15T12:00:00.000Z");
  return backend;
}

export async function assertDuplicateWorkerClaimRejected(tmp: string) {
  const backend = await seedWorkerSubmission(tmp, "container-e2e-duplicate-worker");
  const first = await claimBackendQueuedSubmission(backend, "e2e-worker-0", 1_000);
  const second = await claimBackendQueuedSubmission(backend, "e2e-worker-1", 1_000);
  assert.equal(first?.submissionId, "container-e2e-duplicate-worker");
  assert.equal(second, null);
}

export async function assertStaleWorkerLosesAuthority(tmp: string) {
  const backend = await seedWorkerSubmission(tmp, "container-e2e-stale-worker");
  const stale = await claimBackendQueuedSubmission(backend, "e2e-worker-stale", 40);
  assert.ok(stale);
  const lease = startBackendSubmissionClaimLease({
    backend,
    submissionId: stale.submissionId,
    workerId: "e2e-worker-stale",
    claimToken: stale.claimToken,
    claimMs: 40,
    heartbeatMs: 1_000,
  });
  await sleep(80);
  const replacement = await claimBackendQueuedSubmission(backend, "e2e-worker-replacement", 1_000);
  assert.equal(replacement?.submissionId, stale.submissionId);
  await assert.rejects(lease.assertCurrentAuthority, /worker ownership lost/);
  await lease.stop();
}
