#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { checkControlPlaneReadiness } from "../../deployments/control-plane-process-health";
import { scrubControlPlaneChildEnv } from "../../deployments/control-plane-process-env";
import { writeControlPlaneProcessLog } from "../../deployments/control-plane-process-logging";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { readJson } from "./nixos-shared-host.control-plane.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";

test("readyz reports liveness separately from missing dependencies", async () => {
  await runInTemp("control-plane-readyz-missing-deps", async (tmp) => {
    const previousTimeout = process.env.VBR_DEPLOY_CONTROL_PLANE_DB_CONNECT_TIMEOUT_MS;
    process.env.VBR_DEPLOY_CONTROL_PLANE_DB_CONNECT_TIMEOUT_MS = "50";
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: { statePath: path.join(tmp, "state.json"), hostRoot: tmp, recordsRoot: tmp },
      backendDatabaseUrl: "postgres://127.0.0.1:1/control_plane_missing",
      token: "readyz-token",
      instanceId: "readyz-instance",
    });
    try {
      const healthResponse = await fetch(new URL("/healthz", service.url));
      const readyResponse = await fetch(new URL("/readyz", service.url));
      const ready = await readyResponse.json();
      assert.equal(healthResponse.status, 200);
      assert.equal(readyResponse.status, 503);
      assert.equal(ready.ok, false);
      assert.equal(ready.database.ok, false);
      assert.equal(ready.artifactStore.ok, false);
      assert.deepEqual(ready.workers, []);
      assert.doesNotMatch(JSON.stringify(ready), /readyz-token|postgres:\/\//);
    } finally {
      if (previousTimeout === undefined)
        delete process.env.VBR_DEPLOY_CONTROL_PLANE_DB_CONNECT_TIMEOUT_MS;
      else process.env.VBR_DEPLOY_CONTROL_PLANE_DB_CONNECT_TIMEOUT_MS = previousTimeout;
      await service.close();
    }
  });
});

test("readiness and process logs redact dependency failure details", async () => {
  await runInTemp("control-plane-readyz-redaction", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    const failingStore = {
      ...memoryControlPlaneArtifactStore(),
      getObjectMetadata: async () => {
        throw new Error("artifact token=artifact-secret unavailable");
      },
    };
    const readiness = await checkControlPlaneReadiness({
      backend,
      objectStore: failingStore,
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.database.ok, true);
    assert.equal(readiness.artifactStore.ok, false);
    assert.doesNotMatch(JSON.stringify(readiness), /artifact-secret|token=/);

    const logs: Record<string, unknown>[] = [];
    writeControlPlaneProcessLog((entry) => logs.push(entry), {
      event: "worker_error",
      correlationId: "corr-1",
      mode: "worker",
      workerId: "worker-1",
      error: new Error("provider token=provider-secret failed"),
    });
    assert.equal(logs[0].schemaVersion, "deployment-control-plane-process-log@1");
    assert.equal(logs[0].correlationId, "corr-1");
    assert.match(String(logs[0].error || ""), /redacted/);
    assert.doesNotMatch(JSON.stringify(logs[0]), /provider-secret|token=/);
  });
});

test("worker lifecycle logs share correlation id and child env strips ambient credentials", async () => {
  await runInTemp("control-plane-worker-lifecycle-log", async (tmp) => {
    const logs: Record<string, unknown>[] = [];
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: tmp,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(tmp),
      workerId: "worker-log",
      instanceId: "instance-log",
      logger: (entry) => logs.push(entry),
      heartbeatMs: 25,
    });
    await worker.close();
    assert.deepEqual(
      logs.map((entry) => entry.event),
      ["worker_starting", "worker_stopping", "worker_stopped"],
    );
    assert.equal(new Set(logs.map((entry) => entry.correlationId)).size, 1);
    assert.equal(logs[0].workerId, "worker-log");

    const env = scrubControlPlaneChildEnv(
      {},
      {
        PATH: "/bin",
        AWS_ACCESS_KEY_ID: "artifact-access",
        AWS_SECRET_ACCESS_KEY: "artifact-secret",
        CLOUDFLARE_API_TOKEN: "provider-secret",
        VBR_CONTROL_PLANE_ARTIFACT_STORE_ENDPOINT: "https://secret.example",
      },
    );
    assert.equal(env.PATH, "/bin");
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(env.VBR_CONTROL_PLANE_ARTIFACT_STORE_ENDPOINT, undefined);
  });
});
