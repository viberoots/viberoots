#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startControlPlaneServiceFromRuntimeConfig } from "../../deployments/nixos-shared-host-control-plane-service";

test("service startup config uses instance-profile artifact signing through readiness", async () => {
  await withFakeS3(async (endpoint, headers) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cp-instance-profile-service-"));
    try {
      const runtimeConfig = await loadControlPlaneRuntimeConfig({
        configPath: await writeConfig(tmp, endpoint),
        repoRoot: path.join(tmp, "repo"),
        env: {},
      });
      const service = await startControlPlaneServiceFromRuntimeConfig({
        workspaceRoot: tmp,
        runtimeConfig,
        artifactCredentialProvider: async () => ({
          accessKeyId: "ASIASTARTUP",
          secretAccessKey: "startup-secret",
          sessionToken: "startup-session-token",
          expiration: new Date(Date.now() + 60_000),
          roleName: "control-plane-artifacts",
        }),
      });
      try {
        const ready = await fetch(new URL("/readyz", service.url));
        assert.equal(ready.status, 200);
        assert.match(headers.join("\n"), /Credential=ASIASTARTUP\//);
        assert.match(headers.join("\n"), /token=startup-session-token/);
      } finally {
        await service.close();
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

test("service readiness redacts instance-profile credential provider failures", async () => {
  await withFakeS3(async (endpoint) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cp-instance-profile-failure-"));
    try {
      const runtimeConfig = await loadControlPlaneRuntimeConfig({
        configPath: await writeConfig(tmp, endpoint),
        repoRoot: path.join(tmp, "repo"),
        env: {},
      });
      const service = await startControlPlaneServiceFromRuntimeConfig({
        workspaceRoot: tmp,
        runtimeConfig,
        artifactCredentialProvider: async () => {
          throw new Error("IMDS token startup-secret failed");
        },
      });
      try {
        const response = await fetch(new URL("/readyz", service.url));
        assert.equal(response.status, 503);
        const body = await response.text();
        assert.match(body, /metadata_check_failed/);
        assert.doesNotMatch(body, /startup-secret|IMDS token/);
      } finally {
        await service.close();
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

async function writeConfig(tmp: string, endpoint: string): Promise<string> {
  const credentials = path.join(tmp, "credentials");
  const recordsRoot = path.join(tmp, "records");
  await fsp.mkdir(credentials, { recursive: true });
  await fsp.writeFile(
    path.join(credentials, "control-plane-database-url"),
    localHarnessControlPlaneDatabaseUrl(recordsRoot),
  );
  await fsp.writeFile(path.join(credentials, "control-plane-token"), "service-token");
  await fsp.writeFile(path.join(credentials, "artifact-store-endpoint"), endpoint);
  await fsp.writeFile(path.join(credentials, "reviewed-source-ssh-key"), "ssh-key");
  await fsp.writeFile(path.join(credentials, "reviewed-source-known-hosts"), "known-hosts");
  const configPath = path.join(tmp, "config.yaml");
  await fsp.writeFile(
    configPath,
    [
      "instanceId: instance-profile-service",
      "service:",
      "  host: 127.0.0.1",
      "  port: 7780",
      "  publicUrl: http://127.0.0.1",
      `  tokenFile: ${credentials}/control-plane-token`,
      "storage:",
      `  recordsRoot: ${recordsRoot}`,
      `  artifactStagingRoot: ${tmp}/artifacts`,
      `  runtimeRoot: ${tmp}/runtime`,
      "  artifactStore:",
      "    kind: s3-compatible",
      "    provider: aws-s3",
      "    credentialMode: aws-instance-profile",
      "    bucket: deploy-artifacts",
      "    region: us-east-1",
      `    endpointFile: ${credentials}/artifact-store-endpoint`,
      "database:",
      `  urlFile: ${credentials}/control-plane-database-url`,
      "credentials:",
      `  directory: ${credentials}`,
      "reviewedSource:",
      `  sshKeyFile: ${credentials}/reviewed-source-ssh-key`,
      `  sshKnownHostsFile: ${credentials}/reviewed-source-known-hosts`,
      "",
    ].join("\n"),
  );
  return configPath;
}

async function withFakeS3(fn: (endpoint: string, headers: string[]) => Promise<void>) {
  const headers: string[] = [];
  const server = http.createServer((req, res) => {
    headers.push(
      `${req.headers.authorization || ""} token=${req.headers["x-amz-security-token"] || ""}`,
    );
    res.writeHead(404).end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`, headers);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
