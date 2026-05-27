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

function configYaml(credentials: string, infisicalExtra = "") {
  return `
instanceId: cloud
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
  infisicalDeployments:
    - deploymentId: pleomino-staging
      siteUrl: https://app.infisical.com
      projectId: project-staging
      environment: staging
${infisicalExtra}
reviewedSource:
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
  sshKnownHostsFile: ${credentials}/reviewed-source-known-hosts
`;
}

test("production runtime config requires deployment-scoped Infisical files", async () => {
  await withConfig("runtime-infisical-missing", async ({ credentials }) => {
    await writeRequired(credentials);
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /pleomino-staging\.clientIdFile.*pleomino-staging-infisical-client-id/,
    );
  });
});

test("production runtime config rejects empty Infisical credential files", async () => {
  await withConfig("runtime-infisical-empty", async ({ credentials }) => {
    await writeRequired(credentials);
    await fsp.writeFile(path.join(credentials, "pleomino-staging-infisical-client-id"), "");
    await fsp.writeFile(path.join(credentials, "pleomino-staging-infisical-client-secret"), "");
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /pleomino-staging\.clientIdFile credential file must not be empty/,
    );
  });
});

test("production runtime config rejects mismatched Infisical credential filenames", async () => {
  await withConfig("runtime-infisical-mismatch", async ({ credentials }) => {
    await writeRequired(credentials);
    const config = parseControlPlaneRuntimeConfig(
      configYaml(credentials, `      clientSecretFileName: wrong-infisical-client-secret\n`),
    );

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /clientSecretFileName must be exactly pleomino-staging-infisical-client-secret/,
    );
  });
});

test("production runtime config rejects malformed Infisical deployment IDs", async () => {
  await withConfig("runtime-infisical-malformed-id", async ({ credentials }) => {
    await writeRequired(credentials);
    const config = parseControlPlaneRuntimeConfig(
      configYaml(credentials).replace(
        "deploymentId: pleomino-staging",
        "deploymentId: pleomino/staging",
      ),
    );

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /deploymentId contains characters that cannot be used in credential filenames/,
    );
  });
});

test("production runtime config rejects unreadable Infisical credential files", async () => {
  await withConfig("runtime-infisical-unreadable", async ({ credentials }) => {
    await writeRequired(credentials);
    await fsp.writeFile(path.join(credentials, "pleomino-staging-infisical-client-id"), "id");
    const secretFile = path.join(credentials, "pleomino-staging-infisical-client-secret");
    await fsp.writeFile(secretFile, "secret");
    await fsp.chmod(secretFile, 0o000);
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /failed to read credential file for credentials\.infisicalDeployments\.pleomino-staging\.clientSecretFile/,
    );
    await fsp.chmod(secretFile, 0o600);
  });
});

test("production runtime config accepts deployment-scoped Infisical files", async () => {
  await withConfig("runtime-infisical-complete", async ({ credentials }) => {
    await writeRequired(credentials);
    await fsp.writeFile(path.join(credentials, "pleomino-staging-infisical-client-id"), "id");
    await fsp.writeFile(
      path.join(credentials, "pleomino-staging-infisical-client-secret"),
      "secret",
    );
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));

    await validateControlPlaneRuntimeConfigFiles(config);
  });
});

async function writeRequired(credentials: string): Promise<void> {
  for (const [name, value] of Object.entries({
    "artifact-store-endpoint": "https://s3.test",
    "artifact-store-access-key-id": "access",
    "artifact-store-secret-access-key": "secret",
    "control-plane-database-url": "pgmem://config",
    "control-plane-token": "token",
    "reviewed-source-ssh-key": "ssh-key",
    "reviewed-source-known-hosts": "github.com ssh-ed25519 AAAA",
  })) {
    await fsp.writeFile(path.join(credentials, name), value, "utf8");
  }
}

async function withConfig(
  name: string,
  fn: (paths: { tmp: string; credentials: string }) => Promise<void>,
): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    const credentials = path.join(tmp, "credentials");
    await fsp.mkdir(credentials, { recursive: true });
    await fn({ tmp, credentials });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
