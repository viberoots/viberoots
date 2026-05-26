#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { putVerifiedArtifactObject } from "../../deployments/control-plane-artifact-store";
import { writeBackendArtifactObjectMetadata } from "../../deployments/control-plane-artifact-metadata";
import type { ControlPlaneArtifactObject } from "../../deployments/control-plane-artifact-store-types";
import {
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  readBackendSnapshotBySubmissionId,
  writeBackendSnapshotDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { runNixosSharedHostControlPlaneWorkerOnce } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { runInTemp } from "../lib/test-helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

async function prepareStoredSubmission(tmp: string, $: any, name: string) {
  const deployment = nixosSharedHostDeploymentFixture();
  const recordsRoot = path.join(tmp, "records");
  const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
  const store = memoryControlPlaneArtifactStore();
  const artifactDir = path.join(tmp, name);
  await writeDemoArtifact(artifactDir, name);
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
    dedupe: { mode: "created", requestFingerprint: `fp-${name}` },
    admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
    objectStore: store,
  });
  await enqueueBackendSubmission(
    backend,
    prepared.submission.submissionId,
    prepared.submission.submittedAt,
  );
  return { backend, recordsRoot, store, prepared };
}

test("artifact upload verification fails when stored metadata provenance does not match", async () => {
  const store = memoryControlPlaneArtifactStore();
  const corruptingStore = {
    ...store,
    putObject: async (input: Parameters<typeof store.putObject>[0]) => {
      await store.putObject(input);
      const stored = store.objects.get(input.key);
      if (stored) stored.metadata.provenance_json = JSON.stringify({ payloadKind: "other" });
    },
  };
  await assert.rejects(
    () =>
      putVerifiedArtifactObject({
        store: corruptingStore,
        body: Buffer.from("payload"),
        payloadKind: "artifact",
        provenance: { deploymentId: "deploy", submissionId: "sub", artifactIdentity: "identity" },
      }),
    /provenance_json metadata mismatch/,
  );
});

test("same payload with different admitted-run provenance uses distinct immutable object keys", async () => {
  const store = memoryControlPlaneArtifactStore();
  const body = Buffer.from("same bytes");
  const first = await putVerifiedArtifactObject({
    store,
    body,
    payloadKind: "artifact",
    provenance: {
      deploymentId: "deploy-a",
      submissionId: "submit-a",
      artifactIdentity: "identity",
    },
  });
  const second = await putVerifiedArtifactObject({
    store,
    body,
    payloadKind: "artifact",
    provenance: {
      deploymentId: "deploy-b",
      submissionId: "submit-b",
      artifactIdentity: "identity",
    },
  });
  assert.equal(first.digest, second.digest);
  assert.notEqual(first.key, second.key);
  assert.deepEqual(JSON.parse(store.objects.get(first.key)!.metadata.provenance_json), {
    artifactIdentity: "identity",
    deploymentId: "deploy-a",
    payloadKind: "artifact",
    submissionId: "submit-a",
  });
  assert.deepEqual(JSON.parse(store.objects.get(second.key)!.metadata.provenance_json), {
    artifactIdentity: "identity",
    deploymentId: "deploy-b",
    payloadKind: "artifact",
    submissionId: "submit-b",
  });
});

test("duplicate object writes are idempotent only when stored bytes and metadata match", async () => {
  const store = memoryControlPlaneArtifactStore();
  let writes = 0;
  const countingStore = {
    ...store,
    putObject: async (input: Parameters<typeof store.putObject>[0]) => {
      writes += 1;
      await store.putObject(input);
    },
  };
  const input = {
    store: countingStore,
    body: Buffer.from("same payload"),
    payloadKind: "artifact" as const,
    provenance: { deploymentId: "deploy", submissionId: "sub", artifactIdentity: "identity" },
  };
  const object = await putVerifiedArtifactObject(input);
  assert.equal((await putVerifiedArtifactObject(input)).key, object.key);
  assert.equal(writes, 1);
  store.objects.get(object.key)!.body = Buffer.from("tampered");
  await assert.rejects(() => putVerifiedArtifactObject(input), /digest mismatch|size mismatch/);
});

test("database artifact metadata accepts matching duplicate keys and rejects conflicts", async () => {
  const rows = new Map<string, any>();
  const backend = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("INSERT") && !rows.has(String(params[0]))) {
        rows.set(String(params[0]), {
          object_key: params[0],
          bucket: params[1],
          digest: params[2],
          size_bytes: params[3],
          content_type: params[4],
          provenance_json: params[5],
        });
      }
      return { rows: [rows.get(String(params[0]))].filter(Boolean) };
    },
  };
  const object: ControlPlaneArtifactObject = {
    storeKind: "s3-compatible",
    bucket: "deploy-artifacts",
    key: "control-plane/artifact/sha256/abc",
    digest: "sha256:abc",
    size: 7,
    contentType: "application/octet-stream",
    provenance: { payloadKind: "artifact", deploymentId: "deploy" },
  };
  await writeBackendArtifactObjectMetadata({ backend, object });
  await writeBackendArtifactObjectMetadata({ backend, object });
  await assert.rejects(
    () =>
      writeBackendArtifactObjectMetadata({
        backend,
        object: { ...object, digest: "sha256:def" },
      }),
    /metadata conflicts with immutable key/,
  );
});

test("worker fails closed on object provenance mismatch before provider execution", async () => {
  await runInTemp("control-plane-artifact-worker-provenance-mismatch", async (tmp, $) => {
    const { backend, recordsRoot, store, prepared } = await prepareStoredSubmission(
      tmp,
      $,
      "metadata-mismatch",
    );
    const snapshot = structuredClone(prepared.snapshot) as any;
    const tamperedSnapshot = structuredClone(prepared.snapshot) as any;
    tamperedSnapshot.action.publishInput.artifact.object.provenance.deploymentId =
      "other-deployment";
    snapshot.executionSnapshotObject = await putVerifiedArtifactObject({
      store,
      body: Buffer.from(JSON.stringify(tamperedSnapshot) + "\n"),
      payloadKind: "execution-snapshot",
      contentType: "application/json",
      provenance: {
        deploymentId: snapshot.deploymentId,
        submissionId: snapshot.submissionId,
      },
    });
    await writeBackendSnapshotDoc(backend, snapshot, prepared.executionSnapshotPath);
    await assert.rejects(
      () =>
        runNixosSharedHostControlPlaneWorkerOnce({
          workspaceRoot: tmp,
          recordsRoot,
          backendDatabaseUrl: backend.databaseUrl,
          workerId: "worker-provenance-mismatch",
          objectStore: store,
        }),
      /deploymentId provenance mismatch/,
    );
  });
});

test("worker rejects valid object bodies with bad HEAD metadata before provider execution", async () => {
  await runInTemp("control-plane-artifact-worker-head-mismatch", async (tmp, $) => {
    const { backend, recordsRoot, store, prepared } = await prepareStoredSubmission(
      tmp,
      $,
      "head-mismatch",
    );
    const snapshot = (await readBackendSnapshotBySubmissionId(
      backend,
      prepared.submission.submissionId,
    ))!.snapshot as any;
    store.objects.get(snapshot.executionSnapshotObject.key)!.metadata.provenance_json =
      JSON.stringify({
        payloadKind: "execution-snapshot",
        deploymentId: "other-deployment",
        submissionId: snapshot.submissionId,
      });
    await assert.rejects(
      () =>
        runNixosSharedHostControlPlaneWorkerOnce({
          workspaceRoot: tmp,
          recordsRoot,
          backendDatabaseUrl: backend.databaseUrl,
          workerId: "worker-head-mismatch",
          objectStore: store,
        }),
      /provenance_json metadata mismatch/,
    );
  });
});
