#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  acquireBackendControlPlaneLock,
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  startBackendSubmissionClaimLease,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { CLAIM_BACKEND_QUEUED_SUBMISSION_SQL } from "../../deployments/nixos-shared-host-control-plane-backend-queue";
import { writeCurrentStageStateForDeployRecord } from "../../deployments/deployment-current-stage-state";
import {
  withBackendClient,
  type NixosSharedHostControlPlaneBackendTarget,
} from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { runInTemp } from "../lib/test-helpers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedSubmission(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionId: string;
  state?: "waiting_for_lock" | "running" | "finished";
}) {
  const snapshotPath = path.join(
    opts.backend.recordsRoot,
    "snapshots",
    `${opts.submissionId}.json`,
  );
  const submissionPath = path.join(
    opts.backend.recordsRoot,
    "submissions",
    `${opts.submissionId}.json`,
  );
  await writeBackendSnapshotDoc(
    opts.backend,
    {
      submissionId: opts.submissionId,
      deployment: { environmentStage: "dev", lanePolicy: { artifactReuseMode: "exact" } },
    },
    snapshotPath,
  );
  await writeBackendSubmissionDoc(
    opts.backend,
    {
      submissionId: opts.submissionId,
      submittedAt: "2026-05-01T10:00:00.000Z",
      deploymentId: "demoapp-dev",
      operationKind: "deploy",
      lockScope: "nixos-shared-host:default:demoapp",
      executionSnapshotPath: snapshotPath,
      lifecycleState: opts.state || "waiting_for_lock",
      dedupe: { idempotencyKey: `submit-${opts.submissionId}` },
    },
    { submissionPath, executionSnapshotPath: snapshotPath },
  );
  await enqueueBackendSubmission(opts.backend, opts.submissionId, "2026-05-01T10:00:00.000Z");
}

test("production backend claims skip locked candidates and return unique fencing tokens", async () => {
  await runInTemp("control-plane-concurrent-claims", async (tmp) => {
    assert.match(CLAIM_BACKEND_QUEUED_SUBMISSION_SQL, /FOR UPDATE SKIP LOCKED/);
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await seedSubmission({ backend, submissionId: "cp-one" });
    await seedSubmission({ backend, submissionId: "cp-two" });
    const claimed = [
      await claimBackendQueuedSubmission(backend, "worker-a", 1_000),
      await claimBackendQueuedSubmission(backend, "worker-b", 1_000),
    ];
    assert.equal(new Set(claimed.map((row) => row?.submissionId)).size, 2);
    assert.equal(new Set(claimed.map((row) => row?.claimToken)).size, 2);
    assert.equal(await claimBackendQueuedSubmission(backend, "worker-c", 1_000), null);
  });
});

test("expired queue claims and superseded submissions revoke old worker authority", async () => {
  await runInTemp("control-plane-claim-fencing", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await seedSubmission({ backend, submissionId: "cp-fenced", state: "running" });
    const first = await claimBackendQueuedSubmission(backend, "worker-old", 80);
    assert.ok(first);
    const lease = startBackendSubmissionClaimLease({
      backend,
      submissionId: first.submissionId,
      workerId: "worker-old",
      claimToken: first.claimToken,
      claimMs: 80,
      heartbeatMs: 1_000,
    });
    await sleep(120);
    const takeover = await claimBackendQueuedSubmission(backend, "worker-new", 1_000);
    assert.ok(takeover);
    await assert.rejects(lease.assertCurrentAuthority, /worker ownership lost/);
    await lease.stop();
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-fenced",
        executionSnapshotPath: "snapshot",
        lockScope: "scope",
        lifecycleState: "finished",
      },
      { submissionPath: "submission", executionSnapshotPath: "snapshot" },
    );
    const newLease = startBackendSubmissionClaimLease({
      backend,
      submissionId: takeover.submissionId,
      workerId: "worker-new",
      claimToken: takeover.claimToken,
    });
    await assert.rejects(newLease.assertCurrentAuthority, /worker ownership lost/);
    await newLease.stop();
  });
});

test("backend provider locks are scoped and reject stale fencing tokens", async () => {
  await runInTemp("control-plane-lock-fencing", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    const first = await acquireBackendControlPlaneLock(backend, "provider:demo", {
      waitTimeoutMs: 10,
      pollMs: 1,
    });
    await assert.rejects(
      acquireBackendControlPlaneLock(backend, "provider:demo", { waitTimeoutMs: 5, pollMs: 1 }),
      /lock timeout/,
    );
    await first.release();
    const second = await acquireBackendControlPlaneLock(backend, "provider:demo");
    assert.notEqual(second.fencingToken, first.fencingToken);
    await assert.rejects(first.assertCurrentAuthority, /lock ownership lost/);
    await second.release();
  });
});

test("stage-state writes support compare-and-swap expected-run guards", async () => {
  await runInTemp("control-plane-stage-state-cas", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await seedSubmission({ backend, submissionId: "cp-stage" });
    const record = {
      deployRunId: "deploy-one",
      deploymentId: "demoapp-dev",
      operationKind: "deploy",
      publishMode: "normal",
      finalOutcome: "succeeded",
      artifactIdentity: "static-webapp:one",
      providerTargetIdentity: "nixos-shared-host:default:demoapp",
      admittedContext: { source: { sourceRevision: "abc123" } },
      controlPlane: { submissionId: "cp-stage" },
    };
    await withBackendClient(backend, async (client) => {
      assert.ok(
        await writeCurrentStageStateForDeployRecord({
          client,
          record,
          updatedAt: "2026-05-01T10:01:00.000Z",
        }),
      );
      await assert.rejects(
        writeCurrentStageStateForDeployRecord({
          client,
          record: { ...record, deployRunId: "deploy-two" },
          updatedAt: "2026-05-01T10:02:00.000Z",
          expectedCurrentRunId: "stale-run",
        }),
        /compare-and-swap failed/,
      );
    });
  });
});
