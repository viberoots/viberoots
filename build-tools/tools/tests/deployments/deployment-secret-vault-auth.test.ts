#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime.ts";
import {
  createDeploymentVaultSecretBackend,
  resolveDeploymentVaultAdmittedReferences,
} from "../../deployments/deployment-secret-vault.ts";
import {
  resetVaultCredentialCacheForTests,
  resolveVaultClientCredential,
  resolveVaultCredentialConfig,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
} from "../../deployments/deployment-secret-vault-credentials.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { startFakeVaultServer } from "./vault.test-server.ts";

const originalEnv = { ...process.env };

function restoreVaultEnv() {
  process.env = { ...originalEnv };
  resetVaultCredentialCacheForTests();
}

test("Vault credential resolver selects JWT provider and rejects ambiguous auth", () => {
  const config = resolveVaultCredentialConfig({
    VAULT_ADDR: "https://vault.example.net:8200",
    [VAULT_AUTH_METHOD_ENV]: "jwt",
    [VAULT_JWT_ROLE_ENV]: "deploy-pleomino-read",
    [VAULT_JWT_ENV]: "workload.jwt",
  });
  assert.equal(config.method, "jwt");
  if (config.method === "jwt") assert.equal(config.role, "deploy-pleomino-read");
  assert.throws(
    () =>
      resolveVaultCredentialConfig({
        VAULT_ADDR: "https://vault.example.net:8200",
        [VAULT_AUTH_METHOD_ENV]: "jwt",
        [VAULT_JWT_ENV]: "workload.jwt",
      }),
    /BNX_VAULT_JWT_ROLE/,
  );
  assert.throws(
    () =>
      resolveVaultCredentialConfig({
        VAULT_ADDR: "https://vault.example.net:8200",
        [VAULT_AUTH_METHOD_ENV]: "jwt",
        [VAULT_JWT_ROLE_ENV]: "deploy-pleomino-read",
      }),
    /BNX_VAULT_JWT/,
  );
  assert.throws(
    () =>
      resolveVaultCredentialConfig({
        VAULT_ADDR: "https://vault.example.net:8200",
        [VAULT_AUTH_METHOD_ENV]: "jwt",
        [VAULT_JWT_ROLE_ENV]: "deploy-pleomino-read",
        [VAULT_JWT_ENV]: "workload.jwt",
        VAULT_TOKEN: "pre-minted",
      }),
    /ambiguous Vault auth configuration/,
  );
});

test("Vault token override is available only through explicit token auth", () => {
  assert.throws(
    () =>
      resolveVaultCredentialConfig({
        VAULT_ADDR: "https://vault.example.net:8200",
        VAULT_TOKEN: "break-glass-token",
      }),
    /BNX_VAULT_AUTH_METHOD=token/,
  );
  const config = resolveVaultCredentialConfig({
    VAULT_ADDR: "https://vault.example.net:8200",
    [VAULT_AUTH_METHOD_ENV]: "token",
    VAULT_TOKEN: "break-glass-token",
  });
  assert.deepEqual(config, {
    addr: "https://vault.example.net:8200",
    method: "token",
    token: "break-glass-token",
  });
});

test("JWT login mints an in-memory token for direct Vault secret reads", async () => {
  const vault = await startFakeVaultServer(
    {
      "secret://deployments/pleomino/cloudflare_api_token": {
        currentVersion: "5",
        versions: { "5": { value: "jwt-vault-token" } },
      },
    },
    { jwtAuth: { role: "deploy-pleomino-read", jwt: "signed.workload.jwt" } },
  );
  process.env.VAULT_ADDR = vault.addr;
  process.env[VAULT_AUTH_METHOD_ENV] = "jwt";
  process.env[VAULT_JWT_ROLE_ENV] = "deploy-pleomino-read";
  process.env[VAULT_JWT_ENV] = "signed.workload.jwt";
  delete process.env.VAULT_TOKEN;
  try {
    const admittedReferences = await resolveDeploymentVaultAdmittedReferences({
      requirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/pleomino/cloudflare_api_token",
        }),
      ],
      targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    });
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    });
    assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "jwt-vault-token");
  } finally {
    restoreVaultEnv();
    await vault.close();
  }
});

test("JWT source files and auth failures are explicit and fail closed", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-vault-jwt-"));
  const jwtFile = path.join(tmp, "workload.jwt");
  await fsp.writeFile(jwtFile, "file.workload.jwt\n", "utf8");
  const vault = await startFakeVaultServer(
    {},
    { jwtAuth: { role: "deploy", jwt: "accepted.jwt" } },
  );
  process.env.VAULT_ADDR = vault.addr;
  process.env[VAULT_AUTH_METHOD_ENV] = "jwt";
  process.env[VAULT_JWT_ROLE_ENV] = "deploy";
  process.env[VAULT_JWT_FILE_ENV] = jwtFile;
  try {
    await assert.rejects(
      async () => await resolveVaultClientCredential(),
      /expired JWT, audience, issuer, and claim bindings/,
    );
  } finally {
    restoreVaultEnv();
    await vault.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("JWT auth responses without a client token fail closed", async () => {
  const vault = await startFakeVaultServer(
    {},
    { jwtAuth: { role: "deploy", jwt: "accepted.jwt", missingClientToken: true } },
  );
  process.env.VAULT_ADDR = vault.addr;
  process.env[VAULT_AUTH_METHOD_ENV] = "jwt";
  process.env[VAULT_JWT_ROLE_ENV] = "deploy";
  process.env[VAULT_JWT_ENV] = "accepted.jwt";
  try {
    await assert.rejects(
      async () => await resolveVaultClientCredential(),
      /missing auth\.client_token/,
    );
  } finally {
    restoreVaultEnv();
    await vault.close();
  }
});
