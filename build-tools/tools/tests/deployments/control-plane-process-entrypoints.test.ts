#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  startBackendSubmissionClaimLease,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { scrubControlPlaneChildEnv } from "../../deployments/control-plane-process-env";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  readJson,
  smokeConnectOverride,
  submitServiceRequest,
  waitFor,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import {
  readQueueClaimExpiry,
  waitForClaimRenewal,
} from "./nixos-shared-host.control-plane.backend.helpers";
import { runInTemp } from "../lib/test-helpers";

const TOKEN = "process-entrypoint-token";

test("service exposes health readiness and worker heartbeat state without secret values", async () => {
  await runInTemp("control-plane-process-health", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    const objectStore = memoryControlPlaneArtifactStore();
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: { statePath: path.join(tmp, "state.json"), hostRoot: tmp, recordsRoot },
      backendDatabaseUrl,
      token: TOKEN,
      objectStore,
      instanceId: "cp-test-instance",
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot,
      backendDatabaseUrl,
      workerId: "worker-health",
      objectStore,
      instanceId: "cp-test-instance",
      heartbeatMs: 25,
    });
    try {
      const health = await readJson<any>(await fetch(new URL("/healthz", service.url)));
      assert.deepEqual(health, { ok: true, instanceId: "cp-test-instance" });
      const ready = await readJson<any>(await fetch(new URL("/readyz", service.url)));
      assert.equal(ready.database.ok, true);
      assert.equal(ready.artifactStore.ok, true);
      assert.doesNotMatch(JSON.stringify(ready), /process-entrypoint-token|SECRET/i);
      const heartbeats = await readJson<any>(
        await fetch(new URL("/api/v1/worker-heartbeats", service.url), {
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
      );
      assert.equal(heartbeats.workers[0].workerId, "worker-health");
    } finally {
      await worker.close();
      await service.close();
    }
  });
});

test("worker close records stopped heartbeat and child env scrub removes process credentials", async () => {
  await runInTemp("control-plane-worker-shutdown", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot,
      backendDatabaseUrl: backend.databaseUrl,
      workerId: "worker-stop",
      heartbeatMs: 25,
    });
    await worker.close();
    const row = (
      await queryBackend<any>(
        backend,
        "SELECT status FROM worker_heartbeats WHERE worker_id = $1",
        ["worker-stop"],
      )
    ).rows[0];
    assert.equal(row.status, "stopped");
    const env = scrubControlPlaneChildEnv(
      { REVIEWED_PROVIDER_TOKEN: "allowed" },
      {
        PATH: "/bin",
        VBR_DEPLOY_CONTROL_PLANE_TOKEN: "secret",
        VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL: "postgres://secret",
        CLOUDFLARE_API_TOKEN: "secret",
      },
    );
    assert.equal(env.PATH, "/bin");
    assert.equal(env.REVIEWED_PROVIDER_TOKEN, "allowed");
    assert.equal(env.VBR_DEPLOY_CONTROL_PLANE_TOKEN, undefined);
    assert.equal(env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL, undefined);
    assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  });
});

test("claim leases stop renewing after graceful worker shutdown", async () => {
  await runInTemp("control-plane-worker-lease-shutdown", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await writeBackendSnapshotDoc(backend, { submissionId: "cp-lease" }, `${tmp}/snapshot.json`);
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-lease",
        submittedAt: "2026-05-01T10:00:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "nixos-shared-host:default:demoapp",
        executionSnapshotPath: `${tmp}/snapshot.json`,
        lifecycleState: "running",
      },
      { submissionPath: `${tmp}/submission.json`, executionSnapshotPath: `${tmp}/snapshot.json` },
    );
    await enqueueBackendSubmission(backend, "cp-lease", "2026-05-01T10:00:00.000Z");
    const claimed = await claimBackendQueuedSubmission(backend, "worker-lease", 500);
    assert.ok(claimed);
    const lease = startBackendSubmissionClaimLease({
      backend,
      submissionId: claimed.submissionId,
      workerId: "worker-lease",
      claimToken: claimed.claimToken,
      claimMs: 500,
      heartbeatMs: 50,
    });
    const renewed = await waitForClaimRenewal(
      backend,
      claimed.submissionId,
      await readQueueClaimExpiry(backend, claimed.submissionId),
    );
    await lease.stop();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await readQueueClaimExpiry(backend, claimed.submissionId), renewed);
    await assert.rejects(lease.assertCurrentAuthority, /worker ownership lost/);
  });
});

test("one service and two workers execute a queued fixture submission exactly once", async () => {
  await runInTemp("control-plane-one-service-two-workers", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    const objectStore = memoryControlPlaneArtifactStore();
    await fsp.mkdir(recordsRoot, { recursive: true });
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const publicServer = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: path.join(tmp, "host"),
    });
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: path.join(tmp, "state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot,
      },
      backendDatabaseUrl: backend.databaseUrl,
      token: TOKEN,
      objectStore,
    });
    const workerA = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot,
      backendDatabaseUrl: backend.databaseUrl,
      workerId: "worker-a",
      objectStore,
    });
    const workerB = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot,
      backendDatabaseUrl: backend.databaseUrl,
      workerId: "worker-b",
      objectStore,
    });
    try {
      const submitted = await submitServiceRequest({
        url: service.url,
        deployment,
        artifactDir,
        token: TOKEN,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: smokeConnectOverride(publicServer.port),
      });
      const finished = await waitFor(async () => {
        const rows = await queryBackend<any>(
          backend,
          "SELECT COUNT(*) AS count FROM deploy_records WHERE submission_id = $1",
          [submitted.submissionId],
        );
        return Number(rows.rows[0]?.count || 0) === 1 ? rows.rows[0] : null;
      }, "timed out waiting for exactly one deploy record");
      assert.equal(Number(finished.count), 1);
    } finally {
      await workerA.close();
      await workerB.close();
      await service.close();
      await publicServer.close();
    }
  });
});
