#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";

function yaml(provider: string, mode: string, files = "") {
  return `
instanceId: mini
service:
  publicUrl: https://deploy.example.test
  tokenFile: /run/deployment-control-plane/credentials/control-plane-token
storage:
  artifactStore:
    kind: s3-compatible
    provider: ${provider}
    credentialMode: ${mode}
    bucket: deploy-artifacts
    region: us-east-1
    endpointFile: /run/deployment-control-plane/credentials/artifact-store-endpoint
${files}
database:
  urlFile: /run/deployment-control-plane/credentials/control-plane-database-url
credentials:
  directory: /run/deployment-control-plane/credentials
reviewedSource:
  sshKeyFile: /run/deployment-control-plane/credentials/reviewed-source-ssh-key
  sshKnownHostsFile: /run/deployment-control-plane/credentials/reviewed-source-known-hosts
`;
}

const fileFields = `    accessKeyIdFile: /run/deployment-control-plane/credentials/artifact-store-access-key-id
    secretAccessKeyFile: /run/deployment-control-plane/credentials/artifact-store-secret-access-key`;

test("runtime config accepts AWS instance profile mode without static artifact keys", () => {
  const config = parseControlPlaneRuntimeConfig(yaml("aws-s3", "aws-instance-profile"));
  assert.equal(config.storage.artifactStore.provider, "aws-s3");
  assert.equal(config.storage.artifactStore.credentialMode, "aws-instance-profile");
  assert.equal(config.storage.artifactStore.accessKeyIdFile, undefined);
});

test("runtime config rejects instance profile mode for non-AWS backends", () => {
  assert.throws(
    () => parseControlPlaneRuntimeConfig(yaml("cloudflare-r2", "aws-instance-profile")),
    /aws-instance-profile requires aws-s3/,
  );
});

test("runtime config keeps file-backed mode strict for existing backends", () => {
  const config = parseControlPlaneRuntimeConfig(yaml("cloudflare-r2", "files", fileFields));
  assert.equal(config.storage.artifactStore.credentialMode, "files");
  assert.throws(
    () => parseControlPlaneRuntimeConfig(yaml("cloudflare-r2", "files")),
    /file credential mode requires access key files/,
  );
});
