#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireInfisicalSecret,
  admitInfisicalSecret,
  infisicalSecret,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const clientSecret = "super-client-secret";
const accessToken = "super-access-token";
const secretValue = "super-secret-value";
const expandedReference = "${secret://expanded/reference}";

function assertRedacted(error: unknown) {
  assert.ok(error instanceof Error);
  for (const leaked of [clientSecret, accessToken, secretValue, expandedReference]) {
    assert.ok(!error.message.includes(leaked), `leaked ${leaked}`);
  }
}

test("Infisical adapter redacts Universal Auth client secret from admission errors", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "id",
    clientSecret,
    accessToken,
    status: 401,
    echoClientSecretOnFailure: true,
  });
  try {
    await assert.rejects(
      () => admitInfisicalSecret(server.siteUrl, { clientSecret }),
      (error) => {
        assertRedacted(error);
        return /Universal Auth failed/.test((error as Error).message);
      },
    );
  } finally {
    await server.close();
  }
});

test("Infisical adapter redacts access tokens and expanded references from read errors", async () => {
  const server = await startFakeInfisicalServer({ clientId: "id", clientSecret, accessToken }, [
    infisicalSecret({
      status: 500,
      errorBody: {
        accessToken,
        secretValue,
        expandedReference,
        message: `failed ${accessToken}`,
      },
    }),
  ]);
  try {
    await assert.rejects(
      () => admitInfisicalSecret(server.siteUrl, { clientSecret }),
      (error) => {
        assertRedacted(error);
        return /Infisical secret read failed/.test((error as Error).message);
      },
    );
  } finally {
    await server.close();
  }
});

test("Infisical adapter redacts secret values from runtime mismatch errors", async () => {
  const server = await startFakeInfisicalServer({ clientId: "id", clientSecret, accessToken }, [
    infisicalSecret({ secretValue }),
  ]);
  try {
    const admitted = await admitInfisicalSecret(server.siteUrl, { clientSecret });
    server.secrets[0]!.response = { id: "sec_2", secretValue };
    await assert.rejects(
      () => acquireInfisicalSecret({ siteUrl: server.siteUrl, admitted, clientSecret }),
      (error) => {
        assertRedacted(error);
        return /no longer resolves exactly for id/.test((error as Error).message);
      },
    );
  } finally {
    await server.close();
  }
});
