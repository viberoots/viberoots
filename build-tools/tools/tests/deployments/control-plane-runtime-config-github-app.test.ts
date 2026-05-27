#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";

test("runtime config parser accepts GitHub App reviewed-source mode", () => {
  const credentials = "/run/deployment-control-plane/credentials";
  const config = parseControlPlaneRuntimeConfig(`
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
reviewedSource:
  mode: github-app
  githubAppIdFile: ${credentials}/reviewed-source-github-app-id
  githubAppInstallationIdFile: ${credentials}/reviewed-source-github-app-installation-id
  githubAppPrivateKeyFile: ${credentials}/reviewed-source-github-app-private-key
`);

  assert.deepEqual(config.reviewedSource, {
    mode: "github-app",
    githubAppIdFile: `${credentials}/reviewed-source-github-app-id`,
    githubAppInstallationIdFile: `${credentials}/reviewed-source-github-app-installation-id`,
    githubAppPrivateKeyFile: `${credentials}/reviewed-source-github-app-private-key`,
  });
});

test("runtime config parser rejects mixed reviewed-source credential modes", () => {
  const credentials = "/run/deployment-control-plane/credentials";
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(`
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
reviewedSource:
  mode: github-app
  githubAppIdFile: ${credentials}/reviewed-source-github-app-id
  githubAppInstallationIdFile: ${credentials}/reviewed-source-github-app-installation-id
  githubAppPrivateKeyFile: ${credentials}/reviewed-source-github-app-private-key
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
`),
    /cannot include credentials for another mode: sshKeyFile/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(`
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
reviewedSource:
  mode: ssh
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
  sshKnownHostsFile: ${credentials}/reviewed-source-known-hosts
  githubAppIdFile: ${credentials}/reviewed-source-github-app-id
`),
    /cannot include credentials for another mode: githubAppIdFile/,
  );
});
