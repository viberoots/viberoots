#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime";
import {
  createDeploymentVaultSecretBackend,
  resolveDeploymentVaultAdmittedReferences,
} from "../../deployments/deployment-secret-vault";
import type { DeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import { startFakeVaultServer } from "./vault.test-server";

const originalEnv = { ...process.env };

function restoreVaultEnv() {
  process.env = { ...originalEnv };
}

async function withFixtureFile(
  contracts: Record<string, unknown>,
  run: (fixturePath: string) => Promise<void>,
) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-secret-vault-"));
  const fixturePath = path.join(tmp, "secret-fixture.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({ schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA, contracts }, null, 2) + "\n",
    "utf8",
  );
  try {
    await run(fixturePath);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

test("direct Vault admission freezes one exact version and runtime reuses it", async () => {
  const vault = await startFakeVaultServer({
    "secret://deployments/sample-webapp/cloudflare_api_token": {
      currentVersion: "3",
      versions: {
        "3": { value: "vault-token-v3" },
        "4": { value: "vault-token-v4" },
      },
    },
  });
  const secretContext: DeploymentSecretContext = {
    kind: "vault",
    credential: { kind: "token", addr: vault.addr, token: vault.token },
  };
  delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  try {
    const admittedReferences = await resolveDeploymentVaultAdmittedReferences({
      requirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
        }),
      ],
      targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
      secretContext,
    });
    assert.equal(admittedReferences[0]?.resolvedVersion, "3");
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(secretContext),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
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
    "secret://deployments/sample-webapp/cloudflare_api_token": {
      currentVersion: "7",
      versions: {
        "7": { value: "vault-token-v7" },
      },
    },
  };
  const vault = await startFakeVaultServer(state);
  const secretContext: DeploymentSecretContext = {
    kind: "vault",
    credential: { kind: "token", addr: vault.addr, token: vault.token },
  };
  delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  try {
    const admittedReferences = await resolveDeploymentVaultAdmittedReferences({
      requirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
        }),
      ],
      targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
      secretContext,
    });
    state["secret://deployments/sample-webapp/cloudflare_api_token"].versions["7"].deleted = true;
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentVaultSecretBackend(secretContext),
      admittedReferences,
      targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
    });
    await assert.rejects(
      async () => await runtime.enterStep("publish"),
      /required secret contract secret:\/\/deployments\/sample-webapp\/cloudflare_api_token is missing/,
    );
  } finally {
    restoreVaultEnv();
    await vault.close();
  }
});

test("neutral fixture env var intentionally overrides direct Vault env", async () => {
  const vault = await startFakeVaultServer({
    "secret://deployments/sample-webapp/cloudflare_api_token": {
      currentVersion: "12",
      versions: { "12": { value: "direct-vault-token" } },
    },
  });
  await withFixtureFile(
    {
      "secret://deployments/sample-webapp/cloudflare_api_token": {
        value: "fixture-token",
        version: "fixture-v1",
        allowedSteps: ["publish"],
        targetScopes: ["cloudflare-pages:web-platform-staging/sample-webapp-staging-pages"],
      },
    },
    async (fixturePath) => {
      const secretContext: DeploymentSecretContext = {
        kind: "vault",
        credential: { kind: "token", addr: vault.addr, token: vault.token },
      };
      process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
      try {
        const admittedReferences = await resolveDeploymentVaultAdmittedReferences({
          requirements: [
            deploymentRequirementFixture({
              name: "cloudflare_api_token",
              step: "publish",
              contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
            }),
          ],
          targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
          secretContext,
        });
        assert.equal(admittedReferences[0]?.resolvedVersion, "fixture-v1");
        const runtime = createDeploymentSecretRuntime({
          backend: createDeploymentVaultSecretBackend(secretContext),
          admittedReferences,
          targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
        });
        const publish = await runtime.enterStep("publish");
        assert.equal(publish.cloudflare_api_token, "fixture-token");
      } finally {
        restoreVaultEnv();
      }
    },
  );
  await vault.close();
});

test("retired Vault-named fixture env var is ignored and required secret flows fail closed", async () => {
  await withFixtureFile(
    {
      "secret://deployments/sample-webapp/cloudflare_api_token": {
        value: "fixture-token",
        allowedSteps: ["publish"],
        targetScopes: ["cloudflare-pages:web-platform-staging/sample-webapp-staging-pages"],
      },
    },
    async (fixturePath) => {
      process.env.VBR_DEPLOYMENT_VAULT_FIXTURE_PATH = fixturePath;
      delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
      delete process.env.VAULT_ADDR;
      delete process.env.VAULT_TOKEN;
      try {
        const runtime = createDeploymentSecretRuntime({
          backend: createDeploymentVaultSecretBackend(),
          requirements: [
            deploymentRequirementFixture({
              name: "cloudflare_api_token",
              step: "publish",
              contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
            }),
          ],
          targetScope: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
        });
        await assert.rejects(
          async () => await runtime.enterStep("publish"),
          /explicit deployment secret context/,
        );
      } finally {
        restoreVaultEnv();
      }
    },
  );
});
