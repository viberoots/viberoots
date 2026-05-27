#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  artifactStoreFromRuntimeConfig,
  putVerifiedArtifactObject,
} from "../../deployments/control-plane-artifact-store";
import { createS3CompatibleArtifactStore } from "../../deployments/control-plane-artifact-store-http";

async function withFakeS3(fn: (endpoint: string, authHeaders: string[]) => Promise<void>) {
  const authHeaders: string[] = [];
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
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

function runtimeConfigForTest(tmp: string, credentials: string, endpointFile: string) {
  return {
    instanceId: "mini",
    mode: "protected-shared" as const,
    service: {
      host: "127.0.0.1",
      port: 7780,
      publicUrl: "https://deploy.test",
      tokenFile: path.join(credentials, "control-plane-token"),
    },
    storage: {
      recordsRoot: path.join(tmp, "records"),
      artifactStagingRoot: path.join(tmp, "artifacts"),
      runtimeRoot: path.join(tmp, "runtime"),
      artifactStore: {
        kind: "s3-compatible" as const,
        bucket: "deploy-artifacts",
        region: "us-test-1",
        endpointFile,
        accessKeyIdFile: path.join(credentials, "artifact-store-access-key-id"),
        secretAccessKeyFile: path.join(credentials, "artifact-store-secret-access-key"),
      },
    },
    database: { urlFile: path.join(credentials, "database") },
    credentials: {
      directory: credentials,
      defaults: {
        infisicalClientIdFilePattern: "{deploymentId}-infisical-client-id",
        infisicalClientSecretFilePattern: "{deploymentId}-infisical-client-secret",
      },
    },
    reviewedSource: { mode: "ssh", sshKeyFile: "unused", sshKnownHostsFile: "unused" },
    webUi: { enabled: true, basePath: "/" },
    mcp: { enabled: true, basePath: "/mcp" },
  };
}

test("artifact-store credentials are read from runtime files and errors stay redacted", async () => {
  await withFakeS3(async (endpoint, authHeaders) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-artifact-creds-"));
    try {
      const credentials = path.join(tmp, "credentials");
      await fsp.mkdir(credentials, { recursive: true });
      await fsp.writeFile(path.join(credentials, "endpoint"), endpoint, "utf8");
      await fsp.writeFile(
        path.join(credentials, "artifact-store-access-key-id"),
        "file-access-key",
        "utf8",
      );
      await fsp.writeFile(
        path.join(credentials, "artifact-store-secret-access-key"),
        "file-secret-key",
        "utf8",
      );
      const store = await artifactStoreFromRuntimeConfig(
        runtimeConfigForTest(tmp, credentials, path.join(credentials, "endpoint")),
      );
      await putVerifiedArtifactObject({
        store,
        body: Buffer.from("from files"),
        payloadKind: "artifact",
      });
      assert.match(authHeaders.join("\n"), /Credential=file-access-key\//);
      await fsp.writeFile(path.join(credentials, "bad-endpoint"), "http://127.0.0.1:1", "utf8");
      const unavailable = await artifactStoreFromRuntimeConfig(
        runtimeConfigForTest(tmp, credentials, path.join(credentials, "bad-endpoint")),
      );
      await assert.rejects(
        () =>
          putVerifiedArtifactObject({
            store: unavailable,
            body: Buffer.from("x"),
            payloadKind: "artifact",
          }),
        (error: any) => !String(error?.message || error).includes("file-secret-key"),
      );
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

test(
  "live-gated S3-compatible artifact store conformance uses a temporary object prefix",
  {
    skip:
      !process.env.VBR_ARTIFACT_STORE_LIVE_ENDPOINT ||
      !process.env.VBR_ARTIFACT_STORE_LIVE_BUCKET ||
      !process.env.VBR_ARTIFACT_STORE_LIVE_REGION ||
      !process.env.VBR_ARTIFACT_STORE_LIVE_ACCESS_KEY_ID ||
      !process.env.VBR_ARTIFACT_STORE_LIVE_SECRET_ACCESS_KEY,
  },
  async () => {
    const store = createS3CompatibleArtifactStore({
      endpoint: process.env.VBR_ARTIFACT_STORE_LIVE_ENDPOINT!,
      bucket: process.env.VBR_ARTIFACT_STORE_LIVE_BUCKET!,
      region: process.env.VBR_ARTIFACT_STORE_LIVE_REGION!,
      accessKeyId: process.env.VBR_ARTIFACT_STORE_LIVE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.VBR_ARTIFACT_STORE_LIVE_SECRET_ACCESS_KEY!,
      keyPrefix: process.env.VBR_ARTIFACT_STORE_LIVE_PREFIX || "tmp/vbr-control-plane-live",
    });
    const object = await putVerifiedArtifactObject({
      store,
      body: Buffer.from(`live conformance ${Date.now()}`),
      payloadKind: "artifact",
      provenance: {
        deploymentId: "live-conformance",
        submissionId: crypto.randomUUID(),
        artifactIdentity: "static-webapp:live-conformance",
      },
    });
    assert.equal(
      await store.getObjectMetadata({ key: object.key }).then((meta) => meta.metadata.digest),
      object.digest,
    );
  },
);
