#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createControlPlaneCredentialDirectory } from "../../deployments/control-plane-credentials";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";

function configYaml(
  credentials: string,
  knownHosts = "/etc/deployment-control-plane/github-known-hosts",
) {
  return `
instanceId: mini
service:
  publicUrl: https://deploy.example.test
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
reviewedSource:
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
  sshKnownHostsFile: ${knownHosts}
`;
}

test("credential paths reject repo, nix store, dotenv, image-layer, and argument-style sources", () => {
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(configYaml("/repo/.secrets", "/tmp/hosts"), {
        repoRoot: "/repo",
      }),
    /credential directory is not allowed/,
  );
  assert.throws(
    () => parseControlPlaneRuntimeConfig(configYaml("/nix/store/abc-creds")),
    /directory is not allowed/,
  );
  assert.throws(
    () => parseControlPlaneRuntimeConfig(configYaml("/run/creds/.env.production")),
    /directory is not allowed/,
  );
  assert.throws(
    () => parseControlPlaneRuntimeConfig(configYaml("/app/creds")),
    /directory is not allowed/,
  );
  assert.throws(
    () => parseControlPlaneRuntimeConfig(configYaml("/run/creds", "/app/github-known-hosts")),
    /not allowed/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        configYaml("/run/creds", "--ssh-known-hosts=/run/creds/hosts"),
      ),
    /absolute file path/,
  );
});

test("infisical defaults derive deployment-scoped credential files", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml("/run/deployment-control-plane/credentials"),
  );
  const directory = createControlPlaneCredentialDirectory(config);
  const files = directory.resolveInfisicalCredentialFiles({
    deploymentId: "pleomino-prod",
    siteUrl: "https://infisical.example.test",
    projectId: "project-prod",
    environment: "prod",
  });

  assert.equal(
    files.clientIdFile,
    "/run/deployment-control-plane/credentials/pleomino-prod-infisical-client-id",
  );
  assert.equal(
    files.clientSecretFile,
    "/run/deployment-control-plane/credentials/pleomino-prod-infisical-client-secret",
  );
});

test("reviewed infisical overrides remain deployment-scoped filenames", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml("/run/deployment-control-plane/credentials"),
  );
  const directory = createControlPlaneCredentialDirectory(config);
  const files = directory.resolveInfisicalCredentialFiles({
    deploymentId: "pleomino-staging",
    siteUrl: "https://infisical.example.test",
    projectId: "project-staging",
    environment: "staging",
    clientIdFileName: "pleomino-staging-client-id",
    clientSecretFileName: "pleomino-staging-client-secret",
  });

  assert.equal(
    files.clientIdFile,
    "/run/deployment-control-plane/credentials/pleomino-staging-client-id",
  );
  assert.equal(
    files.clientSecretFile,
    "/run/deployment-control-plane/credentials/pleomino-staging-client-secret",
  );
  assert.throws(
    () =>
      directory.resolveInfisicalCredentialFiles({
        deploymentId: "bad",
        siteUrl: "https://infisical.example.test",
        projectId: "project",
        environment: "prod",
        clientIdFileName: "../global-client-id",
      }),
    /plain filename/,
  );
});

test("multi-tenant infisical lookup keeps account and project facts per deployment", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml("/run/deployment-control-plane/credentials"),
  );
  const directory = createControlPlaneCredentialDirectory(config);
  const first = directory.resolveInfisicalCredentialFiles({
    deploymentId: "storefront-prod",
    siteUrl: "https://infisical.account-a.example",
    projectId: "project-a",
    environment: "prod",
  });
  const second = directory.resolveInfisicalCredentialFiles({
    deploymentId: "ops-staging",
    siteUrl: "https://infisical.account-b.example",
    projectId: "project-b",
    environment: "staging",
    clientIdFileName: "ops-staging-ua-client-id",
    clientSecretFileName: "ops-staging-ua-client-secret",
  });

  assert.notEqual(first.siteUrl, second.siteUrl);
  assert.notEqual(first.projectId, second.projectId);
  assert.notEqual(first.clientIdFile, second.clientIdFile);
  assert.match(first.clientSecretFile, /storefront-prod-infisical-client-secret$/);
  assert.match(second.clientSecretFile, /ops-staging-ua-client-secret$/);
});

test("Pleomino Infisical credential files stay deployment scoped", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml("/run/deployment-control-plane/credentials"),
  );
  const directory = createControlPlaneCredentialDirectory(config);
  for (const [deploymentId, environment] of [
    ["pleomino-staging", "staging"],
    ["pleomino-prod", "prod"],
  ] as const) {
    const files = directory.resolveInfisicalCredentialFiles({
      deploymentId,
      siteUrl: "https://app.infisical.com",
      projectId: "977f71e8-f40b-44e6-b3bb-de0a7abbd826",
      environment,
    });
    assert.match(files.clientIdFile, new RegExp(`${deploymentId}-infisical-client-id$`));
    assert.match(files.clientSecretFile, new RegExp(`${deploymentId}-infisical-client-secret$`));
  }
});

test("credential reads return file contents without leaking contents on read errors", async () => {
  await withScratchTemp("control-plane-credential-directory", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    await fsp.mkdir(credentials, { recursive: true });
    await fsp.writeFile(path.join(credentials, "secret"), "super-secret-value\n", "utf8");
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));
    const directory = createControlPlaneCredentialDirectory(config, {
      repoRoot: path.join(tmp, "repo"),
    });

    assert.equal(
      await directory.readCredentialFile(path.join(credentials, "secret")),
      "super-secret-value",
    );
    await assert.rejects(
      () => directory.readCredentialFile(path.join(credentials, "missing-token=abc123")),
      (error) =>
        error instanceof Error &&
        !error.message.includes("abc123") &&
        error.message.includes("<redacted>"),
    );
  });
});

async function withScratchTemp(name: string, fn: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
