#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  readBackendDeployRecordByDeployRunId,
  readBackendDeployRecordEnvelopeByDeployRunId,
  readBackendDeployRecordEnvelopeBySubmissionId,
  startBackendSubmissionClaimLease,
  syncBackendDeployRecord,
  syncBackendSnapshot,
  syncBackendSubmission,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { readControlPlaneStatus } from "../../deployments/nixos-shared-host-control-plane-service-api";
import { readDeploymentControlPlaneStatus } from "../../deployments/deployment-control-plane-read";
import { reconcileNixosSharedHostRecoveredSubmission } from "../../deployments/nixos-shared-host-recovery";
import {
  createNixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "../../deployments/nixos-shared-host-records";
import { writeControlPlaneJson } from "../../deployments/nixos-shared-host-control-plane-store";
import {
  readQueueClaimExpiry,
  waitForClaimRenewal,
} from "./nixos-shared-host.control-plane.backend.helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSubmissionFixture(opts: {
  recordsRoot: string;
  submissionId: string;
  lifecycleState: "waiting_for_lock" | "running" | "cancelling";
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
}) {
  const deployment = nixosSharedHostDeploymentFixture();
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
  await writeControlPlaneJson(executionSnapshotPath, { submissionId: opts.submissionId });
  await writeControlPlaneJson(submissionPath, {
    schemaVersion: "nixos-shared-host-control-plane-submission@3",
    submissionId: opts.submissionId,
    submittedAt: "2026-04-12T10:00:00.000Z",
    operationKind: "deploy",
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
    lockScope: deployment.providerTarget.sharedDevTargetIdentity,
    executionSnapshotPath,
    lifecycleState: opts.lifecycleState,
    terminationReason: null,
    dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
    admission: { decision: "admitted", reason: "shared_nonprod" },
    ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
    ...(opts.resultRecordPath ? { resultRecordPath: opts.resultRecordPath } : {}),
    ...(opts.finalOutcome ? { finalOutcome: opts.finalOutcome } : {}),
    ...(opts.lifecycleState !== "waiting_for_lock"
      ? {
          workerId: `${opts.submissionId}-worker`,
          execution: {
            currentStep: "publish",
            mutationStartedAt: "2026-04-12T10:00:05.000Z",
          },
        }
      : {}),
  });
  return { deployment, executionSnapshotPath, submissionPath };
}

test("backend claim heartbeat preserves single worker ownership until the lease expires", async () => {
  await runInTemp("nixos-shared-host-control-plane-backend-claim", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = {
      recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    const claimMs = 1_200;
    const { executionSnapshotPath, submissionPath } = await writeSubmissionFixture({
      recordsRoot,
      submissionId: "cp-claim",
      lifecycleState: "waiting_for_lock",
    });
    await syncBackendSnapshot(backend, executionSnapshotPath);
    await syncBackendSubmission(backend, submissionPath);
    await enqueueBackendSubmission(backend, "cp-claim", "2026-04-12T10:00:00.000Z");
    const first = await claimBackendQueuedSubmission(backend, "worker-1", claimMs);
    assert.ok(first);
    const initialExpiry = await readQueueClaimExpiry(backend, first.submissionId);
    assert.ok(initialExpiry > Date.now());
    const lease = startBackendSubmissionClaimLease({
      backend,
      submissionId: first.submissionId,
      workerId: "worker-1",
      claimToken: first.claimToken,
      claimMs,
      heartbeatMs: 100,
    });
    await writeControlPlaneJson(submissionPath, {
      ...(JSON.parse(await fsp.readFile(submissionPath, "utf8")) as Record<string, unknown>),
      lifecycleState: "running",
      workerId: "worker-1",
      execution: {
        currentStep: "publish",
        mutationStartedAt: "2026-04-12T10:00:05.000Z",
      },
    });
    await syncBackendSubmission(backend, submissionPath);
    const renewedExpiry = await waitForClaimRenewal(backend, first.submissionId, initialExpiry);
    await lease.assertCurrentAuthority();
    assert.ok(renewedExpiry > initialExpiry);
    assert.equal(await claimBackendQueuedSubmission(backend, "worker-2", claimMs), null);
    await lease.stop();
    await sleep(claimMs + 100);
    const takeover = await claimBackendQueuedSubmission(backend, "worker-2", claimMs);
    assert.ok(takeover);
    assert.equal(takeover.lifecycleState, "running");
  });
});

test("backend deploy records stay readable by deploy_run_id and submission_id when the JSON mirror lags", async () => {
  await runInTemp("nixos-shared-host-control-plane-backend-records", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = {
      recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    const { deployment, executionSnapshotPath, submissionPath } = await writeSubmissionFixture({
      recordsRoot,
      submissionId: "cp-record",
      lifecycleState: "running",
      deployRunId: "deploy-record",
      resultRecordPath: path.join(recordsRoot, "runs", "deploy-record.json"),
      finalOutcome: "succeeded",
    });
    await syncBackendSubmission(backend, submissionPath);
    const record = createNixosSharedHostDeployRecord(deployment, {
      deployRunId: "deploy-record",
      runClassification: "deploy",
      finalOutcome: "succeeded",
      artifactIdentity: "static-webapp:abc123",
      authority: {
        kind: "control-plane-worker",
        submissionId: "cp-record",
        submissionPath,
        workerId: "worker-1",
        lockScope: deployment.providerTarget.sharedDevTargetIdentity,
        executionSnapshotPath,
      },
    });
    const recordPath = await writeNixosSharedHostDeployRecord(recordsRoot, record);
    await syncBackendDeployRecord(backend, recordPath);
    await fsp.rm(recordPath);
    await fsp.rm(submissionPath);
    const byRunId = await readBackendDeployRecordEnvelopeByDeployRunId(backend, "deploy-record");
    const bySubmissionId = await readBackendDeployRecordEnvelopeBySubmissionId(
      backend,
      "cp-record",
    );
    assert.equal(byRunId?.recordPath, recordPath);
    assert.equal((byRunId?.record as any)?.deployRunId, "deploy-record");
    assert.equal((bySubmissionId?.record as any)?.controlPlane?.submissionId, "cp-record");
    const status = await readControlPlaneStatus(backend, { deployRunId: "deploy-record" });
    assert.equal(status?.lifecycleState, "running");
    assert.equal(status?.finalOutcome, "succeeded");
    assert.equal((status as any)?.resultRecordPath, undefined);
    const backendStatus = await readDeploymentControlPlaneStatus({
      recordsRoot,
      deployRunId: "deploy-record",
      backendDatabaseUrl: backend.databaseUrl,
    });
    assert.equal(backendStatus.lifecycleState, "running");
    assert.equal(backendStatus.deployRunId, "deploy-record");
    assert.equal(
      ((await readBackendDeployRecordByDeployRunId(backend, "deploy-record")) as any)?.deployRunId,
      "deploy-record",
    );
  });
});

test("recovery converges from backend records even when the local run mirror is missing", async () => {
  await runInTemp("nixos-shared-host-control-plane-backend-recovery", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = {
      recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    const { deployment, executionSnapshotPath, submissionPath } = await writeSubmissionFixture({
      recordsRoot,
      submissionId: "cp-recovery",
      lifecycleState: "cancelling",
    });
    await syncBackendSubmission(backend, submissionPath);
    const record = createNixosSharedHostDeployRecord(deployment, {
      deployRunId: "deploy-recovery",
      runClassification: "deploy",
      finalOutcome: "succeeded",
      artifactIdentity: "static-webapp:abc123",
      authority: {
        kind: "control-plane-worker",
        submissionId: "cp-recovery",
        submissionPath,
        workerId: "worker-1",
        lockScope: deployment.providerTarget.sharedDevTargetIdentity,
        executionSnapshotPath,
      },
    });
    const recordPath = await writeNixosSharedHostDeployRecord(recordsRoot, record);
    await syncBackendDeployRecord(backend, recordPath);
    await fsp.rm(recordPath);
    const recovered = await reconcileNixosSharedHostRecoveredSubmission({
      submissionPath,
      recordsRoot,
      backend,
    });
    assert.equal(recovered.lifecycleState, "finished");
    assert.equal(recovered.deployRunId, "deploy-recovery");
    assert.equal(recovered.resultRecordPath, recordPath);
    assert.equal(recovered.finalOutcome, "succeeded");
    assert.equal(recovered.recovery?.decision, "converged_to_final_record");
  });
});
