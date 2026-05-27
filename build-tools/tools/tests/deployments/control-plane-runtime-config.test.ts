#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  loadControlPlaneRuntimeConfig,
  parseControlPlaneRuntimeConfig,
  redactConfigDiagnostic,
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
  sshKnownHostsFile: /etc/deployment-control-plane/github-known-hosts
${extras}`;
}

test("runtime config parser applies container defaults", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml("/run/deployment-control-plane/credentials"),
  );

  assert.equal(config.mode, "protected-shared");
  assert.equal(config.processMode, "fully-enabled");
  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, 7780);
  assert.equal(config.storage.recordsRoot, "/var/lib/deployment-control-plane/records");
  assert.equal(config.storage.artifactStore.kind, "s3-compatible");
  assert.equal(config.storage.artifactStore.region, "auto");
  assert.equal(
    config.credentials.defaults.infisicalClientIdFilePattern,
    "{deploymentId}-infisical-client-id",
  );
  assert.deepEqual(config.webUi, { enabled: true, basePath: "/" });
  assert.deepEqual(config.mcp, { enabled: true, basePath: "/mcp" });
  assert.deepEqual(config.miniMigrationPreflight, { enabled: false });
});

test("runtime config parser accepts explicit values", () => {
  const config = parseControlPlaneRuntimeConfig(
    configYaml(
      "/run/deployment-control-plane/credentials",
      `
mode: dedicated
processMode: service-only
webUi:
  enabled: false
  basePath: /ui/
mcp:
  enabled: false
  basePath: /agent-mcp
miniMigrationPreflight:
  enabled: true
`,
    ),
  );

  assert.equal(config.mode, "dedicated");
  assert.equal(config.processMode, "service-only");
  assert.deepEqual(config.webUi, { enabled: false, basePath: "/ui" });
  assert.deepEqual(config.mcp, { enabled: false, basePath: "/agent-mcp" });
  assert.equal(config.miniMigrationPreflight.enabled, true);
});

test("runtime config parser rejects invalid enum values, base paths, and malformed YAML", () => {
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        configYaml("/run/deployment-control-plane/credentials", "mode: global\n"),
      ),
    /mode has unsupported value/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        configYaml("/run/deployment-control-plane/credentials", "processMode: ghost\n"),
      ),
    /processMode has unsupported value/,
  );
  assert.throws(
    () =>
      parseControlPlaneRuntimeConfig(
        configYaml("/run/deployment-control-plane/credentials", "mcp:\n  basePath: mcp\n"),
      ),
    /mcp\.basePath must be an absolute URL base path/,
  );
  assert.throws(
    () => parseControlPlaneRuntimeConfig("instanceId: ["),
    /Flow sequence in block collection/,
  );
});

test("startup validation fails closed when required credential files are absent", async () => {
  await withScratchTemp("control-plane-runtime-config-missing-files", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    await fsp.mkdir(credentials, { recursive: true });
    const config = parseControlPlaneRuntimeConfig(configYaml(credentials));

    await assert.rejects(
      () => validateControlPlaneRuntimeConfigFiles(config),
      /missing required credential files: database\.urlFile:/,
    );
  });
});

test("loader accepts mounted config override when all required files exist", async () => {
  await withScratchTemp("control-plane-runtime-config-load", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    const configPath = path.join(tmp, "config.yaml");
    await fsp.mkdir(credentials, { recursive: true });
    await fsp.mkdir("/tmp/deployment-control-plane-known-hosts", { recursive: true });
    const knownHosts = "/tmp/deployment-control-plane-known-hosts/github-known-hosts";
    for (const name of [
      "artifact-store-endpoint",
      "artifact-store-access-key-id",
      "artifact-store-secret-access-key",
      "control-plane-database-url",
      "control-plane-token",
      "reviewed-source-ssh-key",
    ]) {
      await fsp.writeFile(path.join(credentials, name), `${name}-value`, "utf8");
    }
    await fsp.writeFile(path.join(credentials, "artifact-store-endpoint"), "https://s3.test");
    await fsp.writeFile(path.join(credentials, "control-plane-database-url"), "pgmem://config");
    await fsp.writeFile(knownHosts, "github.com ssh-ed25519 AAAA", "utf8");
    await fsp.writeFile(
      configPath,
      configYaml(credentials).replace(
        "/etc/deployment-control-plane/github-known-hosts",
        knownHosts,
      ),
      "utf8",
    );

    const config = await loadControlPlaneRuntimeConfig({
      configPath,
      repoRoot: path.join(tmp, "repo"),
      env: {},
    });
    assert.equal(config.instanceId, "mini");
  });
});

test("production loader rejects ambient credential environment variables", async () => {
  await withScratchTemp("control-plane-runtime-config-ambient-env", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    const configPath = path.join(tmp, "config.yaml");
    await fsp.mkdir(credentials, { recursive: true });
    for (const name of [
      "artifact-store-endpoint",
      "artifact-store-access-key-id",
      "artifact-store-secret-access-key",
      "control-plane-database-url",
      "control-plane-token",
      "reviewed-source-ssh-key",
      "reviewed-source-known-hosts",
    ]) {
      await fsp.writeFile(path.join(credentials, name), `${name}-value`, "utf8");
    }
    await fsp.writeFile(path.join(credentials, "artifact-store-endpoint"), "https://s3.test");
    await fsp.writeFile(path.join(credentials, "control-plane-database-url"), "pgmem://config");
    await fsp.writeFile(
      configPath,
      configYaml(credentials).replace(
        "/etc/deployment-control-plane/github-known-hosts",
        path.join(credentials, "reviewed-source-known-hosts"),
      ),
      "utf8",
    );

    await assert.rejects(
      () =>
        loadControlPlaneRuntimeConfig({
          configPath,
          repoRoot: path.join(tmp, "repo"),
          env: {
            VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL: "postgres://user:secret@example/db",
            AWS_SECRET_ACCESS_KEY: "secret-access-key-value",
            VBR_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE: "/tmp/reviewed-source-key",
            VBR_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE: "/tmp/reviewed-source-hosts",
            GIT_SSH_COMMAND: "ssh -i /tmp/ambient-key",
          },
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes("VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL") &&
        error.message.includes("AWS_SECRET_ACCESS_KEY") &&
        error.message.includes("VBR_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE") &&
        error.message.includes("VBR_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE") &&
        error.message.includes("GIT_SSH_COMMAND") &&
        !error.message.includes("secret-access-key-value"),
    );
    const fixture = await loadControlPlaneRuntimeConfig({
      configPath,
      repoRoot: path.join(tmp, "repo"),
      runtimeMode: "local-fixture",
      env: { AWS_SECRET_ACCESS_KEY: "fixture-secret" },
    });
    assert.equal(fixture.instanceId, "mini");
  });
});

test("redaction helper removes inline credential values from diagnostics", () => {
  const redacted = redactConfigDiagnostic(
    "startup failed postgres://user:pass@db token=abc123 clientSecret=swordfish -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  );

  assert.ok(!redacted.includes("abc123"));
  assert.ok(!redacted.includes("swordfish"));
  assert.ok(!redacted.includes("user:pass"));
  assert.ok(!redacted.includes("PRIVATE KEY"));
});

async function withScratchTemp(name: string, fn: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
