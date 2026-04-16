#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime.ts";
import {
  createDeploymentVaultSecretBackend,
  resolveDeploymentVaultAdmittedReferences,
} from "../../deployments/deployment-secret-vault.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { startFakeVaultServer } from "./vault.test-server.ts";

const originalEnv = { ...process.env };

function restoreVaultEnv() {
  process.env = { ...originalEnv };
}

test("direct Vault admission freezes one exact version and runtime reuses it", async () => {
  const vault = await startFakeVaultServer({
    "secret://deployments/pleomino/cloudflare_api_token": {
      currentVersion: "3",
      versions: {
        "3": { value: "vault-token-v3" },
        "4": { value: "vault-token-v4" },
      },
    },
  });
  process.env.VAULT_ADDR = vault.addr;
  process.env.VAULT_TOKEN = vault.token;
  delete process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH;
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
    assert.equal(admittedReferences[0]?.resolvedVersion, "3");
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    });
    const publish = await runtime.enterStep("publish");
    assert.equal(publish.cloudflare_api_token, "vault-token-v3");
  } finally {
    restoreVaultEnv();
    await vault.close();
  }
});

test("direct Vault replay fails closed when the admitted version no longer resolves exactly", async () => {
  const state = {
    "secret://deployments/pleomino/cloudflare_api_token": {
      currentVersion: "7",
      versions: {
        "7": { value: "vault-token-v7" },
      },
    },
  };
  const vault = await startFakeVaultServer(state);
  process.env.VAULT_ADDR = vault.addr;
  process.env.VAULT_TOKEN = vault.token;
  delete process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH;
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
    state["secret://deployments/pleomino/cloudflare_api_token"].versions["7"].deleted = true;
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    });
    await assert.rejects(
      async () => await runtime.enterStep("publish"),
      /required secret contract secret:\/\/deployments\/pleomino\/cloudflare_api_token is missing/,
    );
  } finally {
    restoreVaultEnv();
    await vault.close();
  }
});
