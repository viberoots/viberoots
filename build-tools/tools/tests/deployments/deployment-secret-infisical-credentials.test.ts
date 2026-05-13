#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubDeploymentSecretEnv } from "../../deployments/deployment-secret-env";
import {
  infisicalCredentialFromRuntime,
  normalizeInfisicalSiteUrl,
  redactInfisicalCredentialJson,
  resetInfisicalCredentialCacheForTests,
  resolveInfisicalAccessToken,
} from "../../deployments/deployment-secret-infisical-credentials";
import { vaultSecretCredentialSource } from "../../deployments/deployment-credential-source-selection";
import { startFakeInfisicalServer } from "./infisical.test-server";

const runtime = {
  siteUrl: "https://app.infisical.com",
  projectId: "project",
  environment: "staging",
  preferredCredentialSource: "machine_identity_universal_auth" as const,
  machineIdentityClientIdEnv: "VBR_INFISICAL_CLIENT_ID",
  machineIdentityClientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
};

test("Universal Auth login returns an in-memory Infisical access token", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token-one",
    expiresIn: 60,
  });
  try {
    const token = await resolveInfisicalAccessToken(
      {
        kind: "universal_auth",
        siteUrl: `${server.siteUrl}/`,
        clientId: "client-id",
        clientSecret: "client-secret",
      },
      { nowMs: 1_000, expirySkewMs: 0 },
    );
    assert.equal(token.siteUrl, server.siteUrl);
    assert.equal(token.accessToken, "access-token-one");
    assert.equal(token.expiresAt, "1970-01-01T00:01:01.000Z");
    assert.deepEqual(server.calls, ["client-id"]);
  } finally {
    resetInfisicalCredentialCacheForTests();
    await server.close();
  }
});

test("Universal Auth tokens are reused until expiry and then reacquired", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "cached-token",
    expiresIn: 10,
  });
  try {
    const credential = {
      kind: "universal_auth" as const,
      siteUrl: server.siteUrl,
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    await resolveInfisicalAccessToken(credential, { nowMs: 1_000, expirySkewMs: 0 });
    await resolveInfisicalAccessToken(credential, { nowMs: 5_000, expirySkewMs: 0 });
    await resolveInfisicalAccessToken(credential, { nowMs: 11_000, expirySkewMs: 0 });
    assert.deepEqual(server.calls, ["client-id", "client-id"]);
  } finally {
    resetInfisicalCredentialCacheForTests();
    await server.close();
  }
});

test("Infisical runtime credential source reads only reviewed Universal Auth env names", () => {
  const credential = infisicalCredentialFromRuntime({
    runtime,
    env: {
      VBR_INFISICAL_CLIENT_ID: "client-id",
      VBR_INFISICAL_CLIENT_SECRET: "client-secret",
    },
  });
  assert.equal(credential.kind, "universal_auth");
  assert.equal(credential.clientId, "client-id");
  assert.equal(credential.clientSecret, "client-secret");
});

test("Infisical credential source rejects missing and ambient token input", () => {
  assert.throws(() => infisicalCredentialFromRuntime({ runtime, env: {} }), /client id/);
  assert.throws(
    () =>
      infisicalCredentialFromRuntime({
        runtime,
        env: { VBR_INFISICAL_CLIENT_ID: "client-id" },
      }),
    /client secret/,
  );
  assert.throws(
    () =>
      infisicalCredentialFromRuntime({
        runtime,
        env: { INFISICAL_TOKEN: "ambient", VBR_INFISICAL_CLIENT_ID: "client-id" },
      }),
    /ambient Infisical credential INFISICAL_TOKEN/,
  );
  assert.throws(
    () =>
      infisicalCredentialFromRuntime({
        runtime,
        env: { INFISICAL_PERSONAL_TOKEN: "personal-token" },
      }),
    /ambient Infisical credential INFISICAL_PERSONAL_TOKEN/,
  );
});

test("Infisical auth failures and diagnostics redact secret material", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "expected-secret",
    accessToken: "unused",
    status: 403,
    echoClientSecretOnFailure: true,
  });
  try {
    await assert.rejects(
      () =>
        resolveInfisicalAccessToken({
          kind: "universal_auth",
          siteUrl: server.siteUrl,
          clientId: "client-id",
          clientSecret: "leaked-secret",
        }),
      (error: any) =>
        /Infisical Universal Auth failed: 403/.test(String(error?.message || "")) &&
        !String(error?.message || "").includes("leaked-secret"),
    );
    const redacted = redactInfisicalCredentialJson({
      accessToken: "token-value",
      clientSecret: "secret-value",
    });
    assert.equal(JSON.stringify(redacted).includes("token-value"), false);
    assert.equal(JSON.stringify(redacted).includes("secret-value"), false);
  } finally {
    resetInfisicalCredentialCacheForTests();
    await server.close();
  }
});

test("Infisical auth rejects invalid site URLs and malformed responses", async () => {
  assert.throws(() => normalizeInfisicalSiteUrl("file:///tmp/infisical"), /http or https/);
  assert.throws(() => normalizeInfisicalSiteUrl("https://user:pass@example.com"), /credentials/);
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "unused",
    malformed: true,
  });
  try {
    await assert.rejects(
      () =>
        resolveInfisicalAccessToken({
          kind: "universal_auth",
          siteUrl: server.siteUrl,
          clientId: "client-id",
          clientSecret: "client-secret",
        }),
      /malformed JSON/,
    );
  } finally {
    resetInfisicalCredentialCacheForTests();
    await server.close();
  }
  const missingTokenServer = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "unused",
    missingAccessToken: true,
  });
  try {
    await assert.rejects(
      () =>
        resolveInfisicalAccessToken({
          kind: "universal_auth",
          siteUrl: missingTokenServer.siteUrl,
          clientId: "client-id",
          clientSecret: "client-secret",
        }),
      /missing accessToken/,
    );
  } finally {
    resetInfisicalCredentialCacheForTests();
    await missingTokenServer.close();
  }
});

test("backend-qualified source names avoid reusing Vault labels for Infisical", () => {
  assert.equal(vaultSecretCredentialSource("jenkins_client_secret"), "vault_jenkins_client_secret");
  assert.equal(scrubDeploymentSecretEnv({ PATH: "/bin", INFISICAL_TOKEN: "token" }).PATH, "/bin");
  assert.equal(scrubDeploymentSecretEnv({ INFISICAL_TOKEN: "token" }).INFISICAL_TOKEN, undefined);
});
