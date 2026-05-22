#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readInfisicalSecret } from "../../deployments/deployment-secret-infisical-client";
import { resolveDeploymentInfisicalAdmittedReferences } from "../../deployments/deployment-secret-infisical";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalTargetScope,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer, type FakeInfisicalSecret } from "./infisical.test-server";

const auth = { clientId: "id", clientSecret: "secret", accessToken: "token" };

test("Infisical client does not substitute selector identity for missing response fields", async () => {
  const server = await startFakeInfisicalServer(auth, [
    infisicalSecret({
      response: {
        id: undefined,
        projectId: undefined,
        environment: undefined,
        secretPath: undefined,
        secretName: undefined,
        version: undefined,
      },
    }),
  ]);
  try {
    const record = await readInfisicalSecret({
      credential: infisicalTestContext(server.siteUrl).credential,
      selector: {
        projectId: "proj_123",
        environment: "prod",
        secretPath: "/deployments/pleomino",
        secretName: "cloudflare_api_token",
      },
      viewSecretValue: false,
    });
    assert.deepEqual(record, {
      projectId: "",
      environment: "",
      secretPath: "",
      secretName: "",
      deleted: false,
      revoked: false,
      unavailable: false,
    });
  } finally {
    await server.close();
  }
});

test("Infisical admission rejects incomplete provider replay identity evidence", async () => {
  for (const [field, label] of [
    ["id", "provider secret id"],
    ["projectId", "project id"],
    ["environment", "environment"],
    ["secretPath", "secret path"],
    ["secretName", "secret name"],
    ["version", "version"],
  ] as const) {
    const server = await startFakeInfisicalServer(auth, [
      infisicalSecret({ response: { [field]: undefined } }),
    ]);
    try {
      await assert.rejects(
        () =>
          resolveDeploymentInfisicalAdmittedReferences({
            requirements: [infisicalRequirement],
            targetScope: infisicalTargetScope,
            runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
            secretContext: infisicalTestContext(server.siteUrl),
          }),
        (error) =>
          error instanceof Error &&
          error.message.includes(`missing Infisical replay identity evidence: ${label}`) &&
          error.message.includes(
            "requested selector: proj_123:prod:/deployments/pleomino:cloudflare_api_token",
          ),
      );
    } finally {
      await server.close();
    }
  }
});

function infisicalSecret(overrides: Partial<FakeInfisicalSecret>): FakeInfisicalSecret {
  return {
    id: "sec_1",
    projectId: "proj_123",
    environment: "prod",
    secretPath: "/deployments/pleomino",
    secretName: "cloudflare_api_token",
    version: "3",
    secretValue: "runtime-token-v3",
    ...overrides,
  };
}
