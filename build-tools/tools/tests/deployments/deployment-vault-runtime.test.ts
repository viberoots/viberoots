#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  cleanupDeploymentVaultRuntime,
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  prepareDeploymentVaultRuntime,
} from "../../deployments/deployment-vault-runtime.ts";
import {
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
} from "../../deployments/deployment-secret-vault-credentials.ts";
import { decodeJwtPayload } from "../../deployments/deploy-vault-jwt-claims.ts";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";

test("deployment Vault runtime mints a fresh JWT from deployment-derived claims", async () => {
  const server = await startFakeOidcServer({
    claims: { deployment_environment: "mini" },
  });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-vault-runtime-"));
  const env: NodeJS.ProcessEnv = {
    [DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV]: "super-secret",
  };
  try {
    const result = await prepareDeploymentVaultRuntime({
      workspaceRoot: tmp,
      deployment: cloudflarePagesDeploymentFixture({
        secretRequirements: cloudflarePagesApiTokenRequirements(),
        vaultRuntime: {
          addr: "https://vault.example.net:8200",
          oidcIssuer: server.issuer,
          audience: "deployments-vault",
          deploymentClientId: "deployment-runner",
          deploymentEnvironment: "mini",
          roleName: "deploy-pleomino-read",
        },
      }),
      env,
    });
    assert.equal(result.minted, true);
    assert.equal(env.VAULT_ADDR, "https://vault.example.net:8200");
    assert.equal(env[VAULT_AUTH_METHOD_ENV], "jwt");
    assert.equal(env[VAULT_JWT_ROLE_ENV], "deploy-pleomino-read");
    assert.equal(
      env[VAULT_JWT_FILE_ENV],
      path.join(tmp, ".local", "deploy-vault", "deploy-pleomino-read.jwt"),
    );
    assert.equal((await fsp.stat(env[VAULT_JWT_FILE_ENV]!)).mode & 0o777, 0o600);
    const claims = decodeJwtPayload((await fsp.readFile(env[VAULT_JWT_FILE_ENV]!, "utf8")).trim());
    assert.equal(claims.deployment_environment, "mini");
    assert.equal(claims.repository, "kiltyj/bucknix-fresh");
    assert.equal(claims.azp, "deployment-runner");
    await cleanupDeploymentVaultRuntime(result);
    await assert.rejects(() => fsp.stat(env[VAULT_JWT_FILE_ENV]!), { code: "ENOENT" });
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deployment Vault runtime allows env and flags to override metadata", async () => {
  const server = await startFakeOidcServer({
    claims: { deployment_environment: "override-runner" },
  });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-vault-runtime-override-"));
  const jwtFile = path.join(tmp, "override.jwt");
  const env: NodeJS.ProcessEnv = {
    ALT_CLIENT_SECRET: "super-secret",
  };
  try {
    const result = await prepareDeploymentVaultRuntime({
      workspaceRoot: tmp,
      deployment: cloudflarePagesDeploymentFixture({
        secretRequirements: cloudflarePagesApiTokenRequirements(),
        vaultRuntime: {
          addr: "https://vault.example.net:8200",
          oidcIssuer: server.issuer,
          deploymentEnvironment: "mini",
        },
      }),
      inputs: {
        deploymentEnvironment: "override-runner",
        clientSecretEnv: "ALT_CLIENT_SECRET",
        jwtFile,
      },
      env,
    });
    assert.equal(result.minted, true);
    assert.equal(env[VAULT_JWT_FILE_ENV], jwtFile);
    const claims = decodeJwtPayload((await fsp.readFile(jwtFile, "utf8")).trim());
    assert.equal(claims.deployment_environment, "override-runner");
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deployment Vault runtime leaves explicit inline JWT auth untouched", async () => {
  const env: NodeJS.ProcessEnv = {
    VAULT_ADDR: "https://vault.example.net:8200",
    BNX_VAULT_JWT: "pre.minted.jwt",
  };
  const result = await prepareDeploymentVaultRuntime({
    workspaceRoot: process.cwd(),
    deployment: cloudflarePagesDeploymentFixture({
      secretRequirements: cloudflarePagesApiTokenRequirements(),
    }),
    env,
  });
  assert.equal(result.minted, false);
  assert.equal(env[VAULT_AUTH_METHOD_ENV], undefined);
  assert.equal(env[VAULT_JWT_ROLE_ENV], undefined);
});
