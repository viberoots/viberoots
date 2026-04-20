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
    assert.equal(env.VAULT_ADDR, undefined);
    assert.equal(env.BNX_VAULT_AUTH_METHOD, undefined);
    assert.equal(env.BNX_VAULT_JWT_ROLE, undefined);
    assert.equal(env.BNX_VAULT_JWT_FILE, undefined);
    assert.equal(result.secretContext?.kind, "vault");
    const credential =
      result.secretContext?.kind === "vault" ? result.secretContext.credential : undefined;
    assert.equal(credential?.kind, "jwt");
    assert.equal(credential?.addr, "https://vault.example.net:8200");
    assert.equal(credential?.role, "deploy-pleomino-read");
    const claims = decodeJwtPayload(credential?.kind === "jwt" ? credential.workloadJwt : "");
    assert.equal(claims.deployment_environment, "mini");
    assert.equal(claims.repository, "kiltyj/bucknix-fresh");
    assert.equal(claims.azp, "deployment-runner");
    await cleanupDeploymentVaultRuntime(result);
    assert.equal(credential?.kind === "jwt" ? credential.workloadJwt : "missing", "");
    assert.equal(result.secretContext, undefined);
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
      },
      env,
    });
    assert.equal(result.minted, true);
    assert.equal(env.BNX_VAULT_JWT_FILE, undefined);
    const credential =
      result.secretContext?.kind === "vault" ? result.secretContext.credential : undefined;
    const claims = decodeJwtPayload(credential?.kind === "jwt" ? credential.workloadJwt : "");
    assert.equal(claims.deployment_environment, "override-runner");
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deployment Vault runtime ignores stale ambient Vault auth variables", async () => {
  const env: NodeJS.ProcessEnv = {
    [DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV]: "super-secret",
    VAULT_ADDR: "https://stale.example.invalid:8200",
    BNX_VAULT_AUTH_METHOD: "token",
    BNX_VAULT_JWT: "stale.jwt",
    VAULT_TOKEN: "stale-token",
  };
  const server = await startFakeOidcServer({
    claims: { deployment_environment: "mini" },
  });
  try {
    const result = await prepareDeploymentVaultRuntime({
      workspaceRoot: process.cwd(),
      deployment: cloudflarePagesDeploymentFixture({
        secretRequirements: cloudflarePagesApiTokenRequirements(),
        vaultRuntime: {
          addr: "https://vault.example.net:8200",
          oidcIssuer: server.issuer,
          deploymentEnvironment: "mini",
        },
      }),
      env,
    });
    assert.equal(result.minted, true);
    assert.equal(env.BNX_VAULT_AUTH_METHOD, "token");
    const credential =
      result.secretContext?.kind === "vault" ? result.secretContext.credential : undefined;
    assert.equal(
      credential?.kind === "jwt" ? credential.addr : "",
      "https://vault.example.net:8200",
    );
    assert.notEqual(credential?.kind === "jwt" ? credential.workloadJwt : "", "stale.jwt");
  } finally {
    await server.close();
  }
});
