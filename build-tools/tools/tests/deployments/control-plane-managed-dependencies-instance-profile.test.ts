#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateManagedArtifactStoreProfile,
  validateManagedDependencyEvidence,
} from "../../deployments/control-plane-managed-dependency-validation";
import {
  baseArtifactStore,
  evidence,
} from "./control-plane-managed-dependencies-runtime-path.fixture";

test("AWS S3 instance-profile evidence requires role and least-privilege prefix proof", () => {
  const missing = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        artifactCredentialMode: "aws-instance-profile",
      },
    }),
    60,
  ).join("\n");
  assert.match(missing, /IAM role proof/);
  assert.match(missing, /observed runtime IAM role identity/);
  assert.match(missing, /least-privilege bucket\/prefix policy proof/);

  const wrong = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        artifactCredentialMode: "aws-instance-profile",
        expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
        observedArtifactIamRoleName: "other",
        artifactLeastPrivilegePolicyDigest: "sha256:wrong",
      },
    }),
    60,
    {
      expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      expectedArtifactLeastPrivilegePolicyDigest: "sha256:least-privilege",
    },
  ).join("\n");
  assert.match(wrong, /observed runtime IAM role does not match expected role/);
  assert.match(wrong, /AWS S3 least-privilege policy digest does not match expected value/);
});

test("managed conformance records observed role from runtime credential provider", async () => {
  await withFakeS3(async (endpoint) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "managed-instance-profile-"));
    try {
      const endpointFile = path.join(tmp, "artifact-endpoint");
      await fsp.writeFile(endpointFile, endpoint);
      const evidence = await validateManagedArtifactStoreProfile(
        {
          profileName: "instance-profile",
          runtimePath: {
            expectedHostProfile: "aws-ec2",
            expectedAwsRegion: "us-east-1",
            databaseConnectivityMode: "public",
          },
          postgres: { provider: "postgres-compatible", urlFile: "/dev/null" },
          artifactStore: {
            provider: "aws-s3",
            credentialMode: "aws-instance-profile",
            bucket: "deploy-artifacts",
            region: "us-east-1",
            endpointFile,
          },
        },
        {
          sourceHostIdentity: "i-123",
          sourceHostKind: "aws-ec2",
          s3VpcEndpointId: "vpce-s3",
          artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
          artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
        },
        {
          credentialProvider: async () => ({
            accessKeyId: "ASIAOBSERVED",
            secretAccessKey: "observed-secret",
            sessionToken: "observed-token",
            expiration: new Date(Date.now() + 60_000),
            roleName: "control-plane-host",
          }),
        },
      );
      assert.equal(evidence.observedArtifactIamRoleName, "control-plane-host");
      assert.equal(
        evidence.expectedArtifactIamRoleArn,
        "arn:aws:iam::123456789012:role/control-plane-host",
      );
      assert.doesNotMatch(JSON.stringify(evidence), /observed-secret|observed-token/);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

async function withFakeS3(fn: (endpoint: string) => Promise<void>) {
  const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
  const server = http.createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, {
        body: Buffer.concat(chunks),
        headers: Object.fromEntries(
          Object.entries(req.headers)
            .filter(([name]) => name === "content-type" || name.startsWith("x-amz-meta-"))
            .map(([name, value]) => [name, String(value || "")]),
        ),
      });
      res.writeHead(200).end();
      return;
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404).end("missing");
      return;
    }
    res.writeHead(200, object.headers).end(req.method === "HEAD" ? undefined : object.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
