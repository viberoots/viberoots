#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  readBackendSubmissionBySubmissionId,
  syncBackendSnapshot,
  syncBackendSubmission,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { runNixosSharedHostControlPlaneWorkerOnce } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { writeControlPlaneJson } from "../../deployments/nixos-shared-host-control-plane-store";
import { runInTemp } from "../lib/test-helpers";

async function writeCloudflareSubmission(opts: {
  recordsRoot: string;
  submissionId: string;
  submittedAt: string;
  lifecycleState: "waiting_for_lock" | "running";
}) {
  const deploymentId = "pleomino-staging";
  const deploymentLabel = "//projects/deployments/pleomino/staging:deploy";
  const lockScope = "cloudflare-pages:web-platform-staging/pleomino-staging-pages";
  const executionSnapshotPath = path.join(
    opts.recordsRoot,
    "control-plane",
    "snapshots",
    `${opts.submissionId}.json`,
  );
  const submissionPath = path.join(
    opts.recordsRoot,
    "control-plane",
    "submissions",
    `${opts.submissionId}.json`,
  );
  await writeControlPlaneJson(executionSnapshotPath, {
    submissionId: opts.submissionId,
    submittedAt: opts.submittedAt,
    operationKind: "deploy",
    deploymentId,
    deploymentLabel,
    lockScope,
    deployment: { provider: "cloudflare-pages" },
  });
  await writeControlPlaneJson(submissionPath, {
    submissionId: opts.submissionId,
    submittedAt: opts.submittedAt,
    operationKind: "deploy",
    deploymentId,
    deploymentLabel,
    providerTargetIdentity: lockScope,
    lockScope,
    executionSnapshotPath,
    lifecycleState: opts.lifecycleState,
    terminationReason: null,
    dedupe: { mode: "created", requestFingerprint: `sha256:${opts.submissionId}` },
    ...(opts.lifecycleState === "running"
      ? {
          workerId: "lost-worker",
          execution: {
            currentStep: "smoke",
            mutationStartedAt: opts.submittedAt,
          },
        }
      : {}),
  });
  return { executionSnapshotPath, submissionPath };
}

test("cloudflare backend recovery terminalizes stale running submissions and completes their queue row", async () => {
  await runInTemp("cloudflare-backend-stale-running-recovery", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = {
      recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    const stale = await writeCloudflareSubmission({
      recordsRoot,
      submissionId: "cp-stale",
      submittedAt: "2026-05-01T07:00:00.000Z",
      lifecycleState: "running",
    });
    await syncBackendSnapshot(backend, stale.executionSnapshotPath);
    await syncBackendSubmission(backend, stale.submissionPath);
    await enqueueBackendSubmission(backend, "cp-stale", "2026-05-01T07:00:00.000Z");

    assert.equal(
      await runNixosSharedHostControlPlaneWorkerOnce({
        workspaceRoot: tmp,
        recordsRoot,
        backendDatabaseUrl: backend.databaseUrl,
        workerId: "worker-recover",
      }),
      true,
    );
    const recovered = (await readBackendSubmissionBySubmissionId(backend, "cp-stale")) as any;
    assert.equal(recovered.lifecycleState, "finished");
    assert.equal(recovered.recovery?.decision, "terminated_for_operator_follow_up");
    const queueRow = (
      await queryBackend<{ completed_at?: string }>(
        backend,
        "SELECT completed_at FROM queue WHERE submission_id = $1",
        ["cp-stale"],
      )
    ).rows[0];
    assert.ok(queueRow?.completed_at);
    assert.equal(await claimBackendQueuedSubmission(backend, "worker-next", 1_000), null);
  });
});
