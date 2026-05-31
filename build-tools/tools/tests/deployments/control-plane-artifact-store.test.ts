#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createS3CompatibleArtifactStore } from "../../deployments/control-plane-artifact-store-http";
import {
  assertProductionArtifactStore,
  artifactPayloadDigest,
  materializeArtifactObject,
  putVerifiedArtifactObject,
} from "../../deployments/control-plane-artifact-store";
import { readBackendArtifactObjectMetadata } from "../../deployments/control-plane-artifact-metadata";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendSnapshotBySubmissionId,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

async function withFakeS3(fn: (endpoint: string, authHeaders: string[]) => Promise<void>) {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
  const authHeaders: string[] = [];
  const server = http.createServer(async (req, res) => {
    authHeaders.push(String(req.headers.authorization || ""));
    const key = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const metadata: Record<string, string> = {};
      for (const [header, value] of Object.entries(req.headers)) {
        if (header.startsWith("x-amz-meta-")) {
          metadata[header.slice("x-amz-meta-".length)] = String(value || "");
        }
      }
      objects.set(key, {
        body: Buffer.concat(chunks),
        contentType: String(req.headers["content-type"] || ""),
        metadata,
      });
      res.writeHead(200).end();
      return;
    }
    const value = objects.get(key);
    if (!value) {
      res.writeHead(404).end("missing");
      return;
    }
    const headers = {
      "content-type": value.contentType || "application/octet-stream",
      ...Object.fromEntries(
        Object.entries(value.metadata).map(([name, metadataValue]) => [
          `x-amz-meta-${name}`,
          metadataValue,
        ]),
      ),
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers).end();
      return;
    }
    res.writeHead(200, headers).end(value.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`, authHeaders);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("S3-compatible artifact store verifies put, get, missing object, digest, size, and endpoint failures", async () => {
  await withFakeS3(async (endpoint) => {
    const store = createS3CompatibleArtifactStore({
      provider: "s3-compatible",
      credentialMode: "files",
      endpoint,
      bucket: "deploy-artifacts",
      region: "us-test-1",
      accessKeyId: "access",
      secretAccessKey: "secret",
    });
    const body = Buffer.from("artifact payload\n");
    const object = await putVerifiedArtifactObject({
      store,
      body,
      payloadKind: "artifact",
      provenance: { artifactIdentity: "static-webapp:test" },
    });
    assert.equal((await store.getObject({ key: object.key })).toString(), body.toString());
    await assert.rejects(
      () => store.getObject({ key: "missing" }),
      /get artifact object failed for missing: 404/,
    );
    await assert.rejects(
      () =>
        materializeArtifactObject({
          store,
          object: { ...object, digest: artifactPayloadDigest(Buffer.from("wrong")) },
          outputRoot: os.tmpdir(),
          identity: "static-webapp:test",
        }),
      /digest mismatch/,
    );
    await assert.rejects(
      () =>
        materializeArtifactObject({
          store,
          object: { ...object, size: object.size + 1 },
          outputRoot: os.tmpdir(),
          identity: "static-webapp:test",
        }),
      /size mismatch/,
    );
  });
  const unavailable = createS3CompatibleArtifactStore({
    provider: "s3-compatible",
    credentialMode: "files",
    endpoint: "http://127.0.0.1:1",
    bucket: "deploy-artifacts",
    region: "us-test-1",
    accessKeyId: "access",
    secretAccessKey: "secret",
  });
  await assert.rejects(() =>
    putVerifiedArtifactObject({
      store: unavailable,
      body: Buffer.from("payload"),
      payloadKind: "artifact",
    }),
  );
});

test("backend admission stores artifact payloads in object storage and metadata in database", async () => {
  await runInTemp("control-plane-artifact-store-admission", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    const store = memoryControlPlaneArtifactStore();
    await writeDemoArtifact(artifactDir, "object-store");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);

    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths: {
        statePath: path.join(tmp, "platform-state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot,
      },
      backend,
      artifactDir,
      dedupe: { mode: "created", requestFingerprint: "fp" },
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      objectStore: store,
    });
    const persistedSnapshot = (await readBackendSnapshotBySubmissionId(
      backend,
      prepared.submission.submissionId,
    ))!.snapshot as any;
    const snapshot = prepared.snapshot as any;
    const artifact = snapshot.action.publishInput.artifact;
    assert.match(artifact.storedArtifactPath, /^artifact-object:\/\/deploy-artifacts\//);
    assert.equal(await fsp.stat(artifactDir).then((stat) => stat.isDirectory()), true);
    assert.ok(!(await fsp.stat(artifact.storedArtifactPath).catch(() => null)));
    const row = await readBackendArtifactObjectMetadata(backend, artifact.object.key);
    assert.equal(row?.digest, artifact.object.digest);
    assert.equal(store.objects.has(artifact.object.key), true);
    assert.ok(persistedSnapshot.executionSnapshotObject);
    assert.equal(persistedSnapshot.action, undefined);
    assert.equal(
      (
        await queryBackend<any>(
          backend,
          "SELECT document_json->>'schemaVersion' AS schema FROM snapshots WHERE submission_id = $1",
          [prepared.submission.submissionId],
        )
      ).rows[0]?.schema,
      "control-plane-execution-snapshot-reference@1",
    );
  });
});

test("worker materialization verifies provenance and production mode rejects local-only storage", async () => {
  const store = memoryControlPlaneArtifactStore();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-artifact-materialize-"));
  try {
    const object = await putVerifiedArtifactObject({
      store,
      body: Buffer.from(
        JSON.stringify({
          schemaVersion: "static-webapp-artifact-bundle@1",
          files: [
            {
              path: "index.html",
              mode: "file",
              contentBase64: Buffer.from("ok").toString("base64"),
            },
          ],
        }) + "\n",
      ),
      payloadKind: "artifact",
      provenance: { artifactIdentity: "static-webapp:expected" },
    });
    await assert.rejects(
      () =>
        materializeArtifactObject({
          store,
          object,
          outputRoot: tmp,
          identity: "static-webapp:other",
        }),
      /provenance mismatch/,
    );
    assert.throws(
      () => assertProductionArtifactStore({}),
      /requires an S3-compatible object store/,
    );
    assert.doesNotThrow(() => assertProductionArtifactStore({ localFixture: true }));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
