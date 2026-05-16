#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { putImmutableArtifactObject } from "../../deployments/control-plane-artifact-store";
import {
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { runNixosSharedHostControlPlaneWorkerOnce } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import {
  admitStaticWebappUploadSession,
  createStaticWebappUploadSession,
} from "../../deployments/static-webapp-upload-sessions";
import { createStaticWebappArtifactBundleBytes } from "../../deployments/static-webapp-artifact-bundle";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  memoryControlPlaneArtifactStore,
  tmpControlPlaneDirs,
} from "./control-plane-artifact-store-test-helpers";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

function uploadAdmission(tmp: string, uploadSessionId: string, objectStore?: any) {
  return admitStaticWebappUploadSession({
    recordsRoot: path.join(tmp, "records"),
    submissionId: "submission-1",
    deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
    sourceRevision: "abc123",
    buildTarget: "//projects/apps/demoapp:app",
    uploadSessionId,
    ...(objectStore ? { objectStore } : {}),
  });
}

test("worker fails closed on object mismatch before provider execution", async () => {
  await runInTemp("control-plane-artifact-worker-mismatch", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    const store = memoryControlPlaneArtifactStore();
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir, "mismatch");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths: {
        statePath: path.join(tmp, "state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot,
      },
      backend,
      artifactDir,
      dedupe: { mode: "created", requestFingerprint: "fp" },
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      objectStore: store,
    });
    await enqueueBackendSubmission(
      backend,
      prepared.submission.submissionId,
      prepared.submission.submittedAt,
    );
    const snapshot = prepared.snapshot as any;
    store.objects.set(snapshot.action.publishInput.artifact.object.key, {
      body: Buffer.from("tampered"),
      contentType: snapshot.action.publishInput.artifact.object.contentType,
      metadata: {
        digest: snapshot.action.publishInput.artifact.object.digest,
        size: String(snapshot.action.publishInput.artifact.object.size),
        payload_kind: "artifact",
        provenance_json: JSON.stringify(snapshot.action.publishInput.artifact.object.provenance),
      },
    });
    const beforeTempDirs = await tmpControlPlaneDirs();
    await assert.rejects(
      () =>
        runNixosSharedHostControlPlaneWorkerOnce({
          workspaceRoot: tmp,
          recordsRoot,
          backendDatabaseUrl: backend.databaseUrl,
          workerId: "worker-mismatch",
          objectStore: store,
        }),
      /artifact object (digest|size) mismatch/,
    );
    const afterTempDirs = await tmpControlPlaneDirs();
    assert.deepEqual(afterTempDirs, beforeTempDirs);
  });
});

test("upload sessions use immutable object payloads in production artifact mode", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-upload-object-"));
  try {
    const artifactDir = path.join(tmp, "artifact");
    const store = memoryControlPlaneArtifactStore();
    await writeDemoArtifact(artifactDir, "upload");
    const bytes = await createStaticWebappArtifactBundleBytes(artifactDir);
    const first = await createStaticWebappUploadSession({
      recordsRoot: path.join(tmp, "records"),
      submissionId: "submission-1",
      archiveBytes: bytes,
      objectStore: store,
    });
    const second = await createStaticWebappUploadSession({
      recordsRoot: path.join(tmp, "records"),
      submissionId: "submission-1",
      archiveBytes: bytes,
      objectStore: store,
    });
    assert.equal(first.archiveObject?.key, second.archiveObject?.key);
    await assert.rejects(
      () => uploadAdmission(tmp, first.uploadSessionId),
      /artifact object store is required/,
    );
    assert.ok((await uploadAdmission(tmp, first.uploadSessionId, store)).object);
    await assert.rejects(
      () =>
        putImmutableArtifactObject({
          store,
          object: first.archiveObject!,
          body: Buffer.from("conflict"),
        }),
      /conflicts with immutable key/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("production service upload route rejects local filesystem artifact authority", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-production-reject-"));
  const recordsRoot = path.join(tmp, "records");
  const server = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot,
    },
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    token: "reviewed-token",
  });
  try {
    const response = await fetch(new URL("/api/v1/artifact-uploads/static-webapp", server.url), {
      method: "POST",
      headers: { authorization: "Bearer reviewed-token", "x-vbr-submission-id": "submission-1" },
      body: Buffer.from("{}"),
    });
    assert.equal(response.status, 500);
    assert.match(await response.text(), /requires an S3-compatible object store/);
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("production service upload route stores upload-session metadata in the database", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-production-upload-db-"));
  const recordsRoot = path.join(tmp, "records");
  const databaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
  const store = memoryControlPlaneArtifactStore();
  const artifactDir = path.join(tmp, "artifact");
  await writeDemoArtifact(artifactDir, "upload-db");
  const server = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot,
    },
    backendDatabaseUrl: databaseUrl,
    token: "reviewed-token",
    objectStore: store,
  });
  try {
    const response = await fetch(new URL("/api/v1/artifact-uploads/static-webapp", server.url), {
      method: "POST",
      headers: { authorization: "Bearer reviewed-token", "x-vbr-submission-id": "submission-1" },
      body: await createStaticWebappArtifactBundleBytes(artifactDir),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { uploadSessionId: string };
    const rows = (
      await queryBackend(
        { recordsRoot, databaseUrl },
        `SELECT upload_session_id FROM static_webapp_upload_sessions WHERE upload_session_id = $1`,
        [body.uploadSessionId],
      )
    ).rows;
    assert.equal(rows.length, 1);
    await assert.rejects(
      () => fsp.stat(path.join(recordsRoot, "artifacts", "upload-sessions", body.uploadSessionId)),
      /ENOENT/,
    );
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
