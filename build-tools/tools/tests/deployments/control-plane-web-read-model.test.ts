#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeWorkerHeartbeat } from "../../deployments/control-plane-process-health";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";

const TOKEN = "control-plane-web-token";

test("same-origin read APIs expose headers, worker state, audits, and artifact refs", async () => {
  await runInTemp("control-plane-web-read-model", async (tmp) => {
    const backend = backendFor(tmp);
    await seedDeployment(backend, tmp);
    await writeWorkerHeartbeat(backend, {
      workerId: "worker-a",
      instanceId: "replica-a",
      status: "running",
    });
    const service = await startService(tmp, backend);
    try {
      const rejectedSession = await fetch(new URL("/ops/api/v1/web/session", service.url), {
        method: "POST",
      });
      assert.equal(rejectedSession.status, 401);
      assert.equal(await webSessionCount(backend), 0);
      const headers = { authorization: `Bearer ${TOKEN}`, "x-request-id": "ui-read-123" };
      const workersResponse = await fetch(
        new URL("/ops/api/v1/read/worker-heartbeats", service.url),
        { headers },
      );
      assert.equal(workersResponse.headers.get("cache-control"), "no-store");
      assert.equal(workersResponse.headers.get("x-request-id"), "ui-read-123");
      const workers = (await workersResponse.json()) as any;
      assert.equal(workers.schemaVersion, "control-plane-read-worker-heartbeats@1");
      assert.equal(workers.workers[0].workerId, "worker-a");
      assert.equal(workers.workers[0].instanceId, "replica-a");
      assert.equal(workers.workers[0].status, "running");
      assert.match(workers.workers[0].lastSeenAt, /20\d\d-/);
      const detail = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/deployments/demo-web", service.url), { headers }),
      );
      assert.equal(detail.auditSummary.at(-1).requestId, "ui-read-123");
      assert.equal(detail.auditSummary.at(-1).operation, "read.deployment_detail");
      assert.equal(detail.artifactReferences[0].artifactIdentity, "static-webapp:safe");
      assert.equal(detail.artifactReferences[1].objectKey, "artifacts/demo-web.tar");
      assert.doesNotMatch(JSON.stringify(detail), /artifact-secret|Bearer leaked/);
      const html = await fetch(new URL("/ops/", service.url), {
        headers: { "x-request-id": "ui-html-123" },
      });
      assert.equal(html.headers.get("cache-control"), "no-store");
      assert.equal(html.headers.get("x-request-id"), "ui-html-123");
    } finally {
      await service.close();
    }
  });
});

function backendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function startService(tmp: string, backend: { recordsRoot: string; databaseUrl: string }) {
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: backend.recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    token: TOKEN,
    objectStore: memoryControlPlaneArtifactStore(),
    webUi: { enabled: true, basePath: "/ops" },
  });
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status !== 200) assert.fail(await response.text());
  return (await response.json()) as T;
}

async function webSessionCount(backend: { recordsRoot: string; databaseUrl: string }) {
  const result = await queryBackend<{ count: string }>(
    backend,
    "SELECT COUNT(*) AS count FROM control_plane_web_sessions",
  );
  return Number(result.rows[0]?.count || 0);
}

async function seedDeployment(backend: { recordsRoot: string; databaseUrl: string }, tmp: string) {
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId: "submit-web",
      submittedAt: "2026-05-15T12:00:00.000Z",
      deploymentId: "demo-web",
      deploymentLabel: "//demo:web",
      operationKind: "deploy",
      lockScope: "demo-web",
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
      lifecycleState: "finished",
    } as any,
    {
      submissionPath: path.join(tmp, "submission.json"),
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
    },
  );
  await queryBackend(
    backend,
    `INSERT INTO deploy_records(deploy_run_id, submission_id, record_path, document_json, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      "run-web",
      "submit-web",
      path.join(tmp, "record.json"),
      JSON.stringify({
        deployRunId: "run-web",
        deploymentId: "demo-web",
        finalOutcome: "published",
        providerError: "Authorization: Bearer leaked",
        artifactIdentity: "static-webapp:safe",
        artifactLineageId: "static-webapp:safe",
        artifact: {
          identity: "static-webapp:safe",
          key: "artifacts/demo-web.tar",
          digest: "sha256:abc",
          metadata: { authorization: "Bearer artifact-secret" },
          contents: "artifact-secret",
        },
        controlPlane: { submissionId: "submit-web" },
      }),
      "2026-05-15T12:01:00.000Z",
    ],
  );
}
