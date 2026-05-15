#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action";
import { reviewedCurrentStageExpectation } from "../../deployments/deployment-current-stage-state-expected";
import {
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  readBackendCurrentStageState,
  readBackendSubmissionBySubmissionId,
  syncBackendDeployRecord,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { reconcileNixosSharedHostRecoveredSubmission } from "../../deployments/nixos-shared-host-recovery";
import { writeControlPlaneJson } from "../../deployments/nixos-shared-host-control-plane-store";
import { runNixosSharedHostControlPlaneWorkerOnce } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { runInTemp } from "../lib/test-helpers";

function backend(recordsRoot: string) {
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function seedSnapshot(recordsRoot: string, submissionId: string) {
  const executionSnapshotPath = path.join(recordsRoot, "snapshots", `${submissionId}.json`);
  await writeBackendSnapshotDoc(
    backend(recordsRoot),
    {
      submissionId,
      deployment: { environmentStage: "dev", lanePolicy: { artifactReuseMode: "exact" } },
    },
    executionSnapshotPath,
  );
  return executionSnapshotPath;
}

function deployRecord(deployRunId: string, submissionId: string) {
  return {
    deployRunId,
    deploymentId: "demoapp-dev",
    operationKind: "deploy",
    publishMode: "normal",
    finalOutcome: "succeeded",
    artifactIdentity: `static-webapp:${deployRunId}`,
    providerTargetIdentity: "nixos-shared-host:default:demoapp",
    admittedContext: { source: { sourceRevision: deployRunId } },
    controlPlane: { submissionId },
  };
}

test("backend run actions use durable idempotency instead of file-backed keys", async () => {
  await runInTemp("control-plane-run-action-db-idempotency", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const submissionPath = path.join(recordsRoot, "submissions", "cp-action.json");
    await writeControlPlaneJson(submissionPath, {
      submissionId: "cp-action",
      submittedAt: "2026-05-01T10:00:00.000Z",
      deploymentId: "demoapp-dev",
      operationKind: "deploy",
      lockScope: "scope",
      executionSnapshotPath: "snapshot",
      lifecycleState: "waiting_for_lock",
      dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
    });
    const db = backend(recordsRoot);
    const first = await submitDeploymentControlPlaneRunAction({
      recordsRoot,
      backend: db,
      submissionPath,
      action: "cancel",
      idempotencyKey: "cancel-once",
    });
    const second = await submitDeploymentControlPlaneRunAction({
      recordsRoot,
      backend: db,
      submissionPath,
      action: "cancel",
      idempotencyKey: "cancel-once",
    });
    assert.equal(second.actionId, first.actionId);
    assert.equal(second.latestAction?.dedupe.mode, "reused");
    await assert.rejects(fsp.access(path.join(recordsRoot, "control-plane", "idempotency")));
    const row = (
      await queryBackend<{ target_id?: string }>(
        db,
        "SELECT target_id FROM idempotency WHERE kind = $1",
        ["run_action"],
      )
    ).rows[0];
    assert.equal(row?.target_id, first.actionId);
  });
});

test("backend deploy-record writes use guarded stage-state updates", async () => {
  await runInTemp("control-plane-stage-state-production-cas", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    await seedSnapshot(recordsRoot, "cp-stage-prod");
    await writeBackendDeployRecordDoc(db, deployRecord("deploy-one", "cp-stage-prod"), "one.json", {
      expectedCurrentRunId: null,
    });
    await assert.rejects(
      writeBackendDeployRecordDoc(
        db,
        { ...deployRecord("deploy-stale", "cp-stage-prod"), parentRunId: "deploy-one" },
        "stale.json",
        { expectedCurrentRunId: "not-current" },
      ),
      /compare-and-swap failed/,
    );
    assert.equal(
      (
        await readBackendCurrentStageState(db, {
          deploymentId: "demoapp-dev",
          environmentStage: "dev",
        })
      )?.currentRunId,
      "deploy-one",
    );
    const reviewed = await reviewedCurrentStageExpectation({
      backend: db,
      deployment: { deploymentId: "demoapp-dev", environmentStage: "dev" } as any,
    });
    await writeBackendDeployRecordDoc(
      db,
      deployRecord("deploy-two", "cp-stage-prod"),
      "two.json",
      reviewed,
    );
    const state = await readBackendCurrentStageState(db, {
      deploymentId: "demoapp-dev",
      environmentStage: "dev",
    });
    assert.equal(state?.currentRunId, "deploy-two");
    assert.deepEqual(
      (
        await queryBackend<{ deploy_run_id?: string }>(
          db,
          `SELECT deploy_run_id FROM stage_state_history
           WHERE deployment_id = $1 ORDER BY deploy_run_id ASC`,
          ["demoapp-dev"],
        )
      ).rows.map((row) => row.deploy_run_id),
      ["deploy-one", "deploy-two"],
    );
  });
});

test("recovery reconciles from database records instead of poisoned local mirrors", async () => {
  await runInTemp("control-plane-recovery-db-authority", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    const executionSnapshotPath = await seedSnapshot(recordsRoot, "cp-recover-db");
    const submissionPath = path.join(recordsRoot, "submissions", "cp-recover-db.json");
    await writeControlPlaneJson(submissionPath, {
      submissionId: "cp-recover-db",
      deploymentId: "demoapp-dev",
      lockScope: "scope",
      executionSnapshotPath,
      lifecycleState: "cancelling",
    });
    await writeBackendSubmissionDoc(db, JSON.parse(await fsp.readFile(submissionPath, "utf8")), {
      submissionPath,
      executionSnapshotPath,
    });
    const recordPath = path.join(recordsRoot, "runs", "deploy-db.json");
    await writeControlPlaneJson(recordPath, deployRecord("deploy-db", "cp-recover-db"));
    await syncBackendDeployRecord(db, recordPath);
    await writeControlPlaneJson(recordPath, {
      deployRunId: "local-poison",
      finalOutcome: "failed",
    });
    const recovered = await reconcileNixosSharedHostRecoveredSubmission({
      submissionPath,
      recordsRoot,
      backend: db,
    });
    assert.equal(recovered.deployRunId, "deploy-db");
    assert.equal(recovered.finalOutcome, "succeeded");
  });
});

test("two workers cannot claim and execute the same durable submission", async () => {
  await runInTemp("control-plane-two-worker-single-execution", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    const executionSnapshotPath = await seedSnapshot(recordsRoot, "cp-two-workers");
    await writeBackendSubmissionDoc(
      db,
      {
        submissionId: "cp-two-workers",
        submittedAt: "2026-05-01T10:00:00.000Z",
        deploymentId: "demoapp-dev",
        lockScope: "scope",
        executionSnapshotPath,
        lifecycleState: "running",
      },
      { submissionPath: "submission", executionSnapshotPath },
    );
    await enqueueBackendSubmission(db, "cp-two-workers", "2026-05-01T10:00:00.000Z");
    const workerResults = await Promise.all([
      runNixosSharedHostControlPlaneWorkerOnce({
        workspaceRoot: tmp,
        recordsRoot,
        backendDatabaseUrl: db.databaseUrl,
        workerId: "worker-a",
      }),
      runNixosSharedHostControlPlaneWorkerOnce({
        workspaceRoot: tmp,
        recordsRoot,
        backendDatabaseUrl: db.databaseUrl,
        workerId: "worker-b",
      }),
    ]);
    assert.equal(workerResults.filter(Boolean).length, 1);
    const submission = (await readBackendSubmissionBySubmissionId(db, "cp-two-workers")) as any;
    assert.equal(submission.recovery?.decision, "terminated_for_operator_follow_up");
  });
});
