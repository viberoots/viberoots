#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCredentialSourceVaultJwt } from "../../deployments/deployment-credential-source-runtime";
import { decodeJwtPayload } from "../../deployments/deploy-vault-jwt-claims";
import { scrubDeploymentSecretEnv } from "../../deployments/deployment-secret-env";
import { fakeJwt, startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";

function runtimeBase(issuerUrl: string, env: NodeJS.ProcessEnv) {
  return {
    addr: "https://vault.example.net:8200",
    roleName: "deploy-pleomino-read",
    issuerUrl,
    audience: "deployments-vault",
    repository: "kiltyj/viberoots",
    deploymentEnvironment: "mini",
    humanClientId: "deployment-cli",
    serviceClientId: "deployment-runner",
    clientSecretEnv: "JENKINS_DEPLOYMENT_CLIENT_SECRET",
    externalOidcTokenEnv: "JENKINS_OIDC_TOKEN",
    env,
    openBrowser: false,
  };
}

test("Jenkins Secret Text source mints a typed in-memory Vault JWT", async () => {
  const server = await startFakeOidcServer();
  try {
    const result = await resolveCredentialSourceVaultJwt({
      ...runtimeBase(server.issuer, { JENKINS_DEPLOYMENT_CLIENT_SECRET: "secret" }),
      source: "jenkins_client_secret",
    });
    assert.equal(result.source, "jenkins_client_secret");
    assert.equal(result.addr, "https://vault.example.net:8200");
    const claims = decodeJwtPayload(result.workloadJwt);
    assert.equal(claims.azp, "deployment-runner");
    assert.equal(claims.repository, "kiltyj/viberoots");
  } finally {
    await server.close();
  }
});

test("external OIDC source validates claims without a Keycloak client secret", async () => {
  const server = await startFakeOidcServer();
  const token = fakeJwt({
    iss: server.issuer,
    aud: "deployments-vault",
    azp: "deployment-runner",
    deployment_environment: "mini",
    repository: "kiltyj/viberoots",
  });
  try {
    const result = await resolveCredentialSourceVaultJwt({
      ...runtimeBase(server.issuer, { JENKINS_OIDC_TOKEN: token }),
      source: "external_oidc_token",
    });
    assert.equal(result.workloadJwt, token);
  } finally {
    await server.close();
  }
});

test("Jenkins-bound secrets and tokens are scrubbed from provider subprocess env", () => {
  const env = scrubDeploymentSecretEnv({
    PATH: "/bin",
    JENKINS_DEPLOYMENT_CLIENT_SECRET: "secret",
    VBR_DEPLOYMENT_OIDC_TOKEN: "token",
    VBR_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV: "JENKINS_OIDC_TOKEN",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.VBR_DEPLOYMENT_OIDC_TOKEN, undefined);
  assert.equal(env.VBR_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV, undefined);
  assert.equal(env.JENKINS_DEPLOYMENT_CLIENT_SECRET, undefined);
});
