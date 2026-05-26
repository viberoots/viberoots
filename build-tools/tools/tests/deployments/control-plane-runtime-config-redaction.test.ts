#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  parseControlPlaneRuntimeConfig,
  validateControlPlaneRuntimeConfigFiles,
} from "../../deployments/control-plane-runtime-config";

function configYaml(credentials: string, extras = "") {
  return `
instanceId: mini
service:
  publicUrl: https://deploy.example.test
  tokenFile: ${credentials}/control-plane-token
storage:
  artifactStore:
    bucket: deploy-artifacts
    endpointFile: ${credentials}/artifact-store-endpoint
    accessKeyIdFile: ${credentials}/artifact-store-access-key-id
    secretAccessKeyFile: ${credentials}/artifact-store-secret-access-key
database:
  urlFile: ${credentials}/control-plane-database-url
credentials:
  directory: ${credentials}
  defaults:
    infisicalClientIdFilePattern: "{deploymentId}-infisical-client-id"
    infisicalClientSecretFilePattern: "{deploymentId}-infisical-client-secret"
reviewedSource:
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
  sshKnownHostsFile: ${credentials}/reviewed-source-known-hosts
${extras}`;
}

test("runtime config parser enforces exact credential filename contract", () => {
  const base = configYaml("/run/deployment-control-plane/credentials");
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(base.replace("artifact-store-endpoint", "artifact-endpoint")),
    /endpointFile must use credential filename artifact-store-endpoint/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        base.replace(
          '"{deploymentId}-infisical-client-id"',
          '"prefix-{deploymentId}-infisical-client-id"',
        ),
      ),
    /infisicalClientIdFilePattern must be exactly \{deploymentId\}-infisical-client-id/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        base.replace('"{deploymentId}-infisical-client-secret"', '"{deploymentId}-wrong-secret"'),
      ),
    /infisicalClientSecretFilePattern must be exactly \{deploymentId\}-infisical-client-secret/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        base.replace(
          "  tokenFile: /run/deployment-control-plane/credentials/control-plane-token\n",
          "",
        ),
      ),
    /service\.tokenFile must be a non-empty string/,
  );
});

test("missing credential-file diagnostics stay redacted", async () => {
  await withCredentialFixture("runtime-config-missing-redaction", async (credentials) => {
    const missing = path.join(credentials, "missing-token=secret-file-token");
    const config = parseControlPlaneRuntimeConfig(
      configYaml(credentials).replace(`${credentials}/control-plane-token`, missing),
    );
    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      (error) =>
        error instanceof Error &&
        error.message.includes("service.tokenFile") &&
        error.message.includes("token=<redacted>") &&
        !error.message.includes("secret-file-token"),
    );
  });
});

test("malformed credential-file diagnostics do not echo secret values", async () => {
  await withCredentialFixture("runtime-config-malformed-redaction", async (credentials) => {
    await fsp.writeFile(
      path.join(credentials, "control-plane-database-url"),
      "postgres://user:db-secret-token@example.test/db",
    );
    await fsp.writeFile(
      path.join(credentials, "artifact-store-endpoint"),
      "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
    );
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));
    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      (error) =>
        error instanceof Error &&
        error.message.includes("storage.artifactStore.endpointFile") &&
        !error.message.includes("db-secret-token") &&
        !error.message.includes("PRIVATE KEY") &&
        !error.message.includes("private-key-material"),
    );
  });
});

test("unreadable credential-file diagnostics do not echo secret contents", async () => {
  await withCredentialFixture("runtime-config-unreadable-redaction", async (credentials) => {
    const filePath = path.join(credentials, "control-plane-database-url");
    await fsp.writeFile(filePath, "postgres://user:unreadable-secret@example.test/db");
    await fsp.chmod(filePath, 0);
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));
    try {
      await assert.rejects(
        () => validateControlPlaneRuntimeConfigFiles(config),
        (error) =>
          error instanceof Error &&
          error.message.includes("database.urlFile") &&
          error.message.includes("failed to read credential file") &&
          !error.message.includes("unreadable-secret"),
      );
    } finally {
      await fsp.chmod(filePath, 0o600).catch(() => {});
    }
  });
});

async function withCredentialFixture(name: string, fn: (credentials: string) => Promise<void>) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  const credentials = path.join(tmp, "credentials");
  try {
    await fsp.mkdir(credentials, { recursive: true });
    await writeValidCredentials(credentials);
    await fn(credentials);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function writeValidCredentials(credentials: string): Promise<void> {
  const values: Record<string, string> = {
    "artifact-store-endpoint": "https://s3.example.test",
    "artifact-store-access-key-id": "access-key-id",
    "artifact-store-secret-access-key": "secret-access-key",
    "control-plane-database-url": "pgmem://runtime-config",
    "control-plane-token": "service-token",
    "reviewed-source-ssh-key": "ssh-key",
    "reviewed-source-known-hosts": "github.com ssh-ed25519 AAAA",
  };
  for (const [name, value] of Object.entries(values)) {
    await fsp.writeFile(path.join(credentials, name), value, "utf8");
  }
}
