#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime.ts";
import {
  createDeploymentVaultSecretBackend,
  resolveDeploymentVaultAdmittedReferences,
} from "../../deployments/deployment-secret-vault.ts";
import {
  resetVaultCredentialCacheForTests,
  resolveVaultClientCredential,
  type VaultCredentialConfig,
} from "../../deployments/deployment-secret-vault-credentials.ts";
import type { DeploymentSecretContext } from "../../deployments/deployment-secret-context.ts";
import { scrubDeploymentSecretEnv } from "../../deployments/deployment-secret-env.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { startFakeVaultServer } from "./vault.test-server.ts";

function jwtCredential(addr: string, role = "deploy-pleomino-read"): VaultCredentialConfig {
  return { kind: "jwt", addr, role, workloadJwt: "signed.workload.jwt" };
}

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
  const secretContext: DeploymentSecretContext = {
    kind: "vault",
    credential: jwtCredential(vault.addr),
  };
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
      secretContext,
    });
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(secretContext),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    });
    assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "jwt-vault-token");
  } finally {
    resetVaultCredentialCacheForTests();
    await vault.close();
  }
});

test("stale ambient Vault variables do not satisfy deployment secret resolution", async () => {
  const originalEnv = { ...process.env };
  process.env.VAULT_ADDR = "https://ambient.example.invalid";
  process.env.BNX_VAULT_AUTH_METHOD = "token";
  process.env.VAULT_TOKEN = "ambient-token";
  try {
    await assert.rejects(
      async () =>
        await resolveDeploymentVaultAdmittedReferences({
          requirements: [
            deploymentRequirementFixture({
              name: "cloudflare_api_token",
              step: "publish",
              contractId: "secret://deployments/pleomino/cloudflare_api_token",
            }),
          ],
          targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
        }),
      /explicit deployment secret context/,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("provider subprocess env scrubbing removes Vault and deployment secrets", () => {
  const env = scrubDeploymentSecretEnv({
    PATH: "/bin",
    VAULT_ADDR: "https://vault.example.net",
    VAULT_TOKEN: "vault-token",
    BNX_VAULT_JWT: "workload.jwt",
    BNX_VAULT_JWT_FILE: "/tmp/workload.jwt",
    BNX_DEPLOYER_CLIENT_SECRET: "client-secret",
    DEPLOYMENT_CLIENT_SECRET: "deployment-secret",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.VAULT_ADDR, undefined);
  assert.equal(env.VAULT_TOKEN, undefined);
  assert.equal(env.BNX_VAULT_JWT, undefined);
  assert.equal(env.BNX_VAULT_JWT_FILE, undefined);
  assert.equal(env.BNX_DEPLOYER_CLIENT_SECRET, undefined);
  assert.equal(env.DEPLOYMENT_CLIENT_SECRET, undefined);
});

test("JWT auth failures fail closed without exposing workload JWTs", async () => {
  const vault = await startFakeVaultServer(
    {},
    { jwtAuth: { role: "deploy", jwt: "accepted.jwt" } },
  );
  await assert.rejects(
    async () =>
      await resolveVaultClientCredential({
        kind: "jwt",
        addr: vault.addr,
        role: "deploy",
        workloadJwt: "rejected.workload.jwt",
      }),
    (error: any) =>
      /expired JWT, audience, issuer, and claim bindings/.test(String(error?.message || "")) &&
      !String(error?.message || "").includes("rejected.workload.jwt"),
  );
  resetVaultCredentialCacheForTests();
  await vault.close();
});

test("JWT auth responses without a client token fail closed", async () => {
  const vault = await startFakeVaultServer(
    {},
    { jwtAuth: { role: "deploy", jwt: "accepted.jwt", missingClientToken: true } },
  );
  await assert.rejects(
    async () =>
      await resolveVaultClientCredential({
        kind: "jwt",
        addr: vault.addr,
        role: "deploy",
        workloadJwt: "accepted.jwt",
      }),
    /missing auth\.client_token/,
  );
  resetVaultCredentialCacheForTests();
  await vault.close();
});
