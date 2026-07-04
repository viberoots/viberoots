#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeploymentInfisicalSecretBackend,
  resolveDeploymentInfisicalAdmittedReferences,
} from "../../deployments/deployment-secret-infisical";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime";
import {
  infisicalContractId,
  infisicalRequirement,
  infisicalRuntime,
  infisicalTargetScope,
  infisicalTestContext,
  restoreInfisicalTestEnv,
  withInfisicalFixtureFile,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const auth = { clientId: "id", clientSecret: "secret", accessToken: "token" };

test("Infisical admission freezes non-secret selector and runtime reads admitted version", async () => {
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_1",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/deployments/sample-webapp",
      secretName: "cloudflare_api_token",
      version: "3",
      secretValue: "token-v3",
    },
  ]);
  const context = infisicalTestContext(server.siteUrl);
  try {
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      secretContext: context,
    });
    assert.equal(admitted[0]?.backend, "infisical");
    assert.equal(admitted[0]?.resolvedVersion, "3");
    assert.equal(
      admitted[0]?.referenceId,
      "infisical:proj_123:prod:/deployments/sample-webapp:cloudflare_api_token#sec_1@3",
    );
    assert.equal(server.secretCalls[0], "cloudflare_api_token:false:");
    assert.ok(!JSON.stringify(admitted).includes("token-v3"));
    server.secrets.unshift({
      id: "sec_1",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/deployments/sample-webapp",
      secretName: "cloudflare_api_token",
      version: "4",
      secretValue: "token-v4",
    });
    const runtimeSecrets = createDeploymentSecretRuntime({
      backend: createDeploymentInfisicalSecretBackend(context),
      admittedReferences: admitted,
      targetScope: infisicalTargetScope,
    });
    const publish = await runtimeSecrets.enterStep("publish");
    assert.equal(publish.cloudflare_api_token, "token-v3");
    assert.ok(server.secretCalls.includes("cloudflare_api_token:true:3"));
  } finally {
    restoreInfisicalTestEnv();
    await server.close();
  }
});

test("Infisical mapping overrides default path and secret name", async () => {
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_mapped",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/custom",
      secretName: "api-token",
      version: "9",
    },
  ]);
  try {
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      mappings: { [infisicalContractId]: { secretPath: "/custom", secretName: "api-token" } },
      secretContext: infisicalTestContext(server.siteUrl),
    });
    assert.equal(admitted[0]?.selectorRef, "proj_123:prod:/custom:api-token@9");
  } finally {
    await server.close();
  }
});

test("fake Infisical server rejects the old v3 raw-secret read shape", async () => {
  const server = await startFakeInfisicalServer(auth, []);
  try {
    const old = await fetch(`${server.siteUrl}/api/v3/secrets/raw/cloudflare_api_token`);
    assert.equal(old.status, 410);
    const invalidV4 = await fetch(
      `${server.siteUrl}/api/v4/secrets/cloudflare_api_token?workspaceId=proj_123&secretVersion=3`,
    );
    assert.equal(invalidV4.status, 400);
  } finally {
    await server.close();
  }
});

test("Infisical missing optional secrets are skipped and required secrets fail", async () => {
  const server = await startFakeInfisicalServer(auth);
  const context = infisicalTestContext(server.siteUrl);
  try {
    const optional = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [{ ...infisicalRequirement, required: false }],
      targetScope: infisicalTargetScope,
      runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      secretContext: context,
    });
    assert.deepEqual(optional, []);
    await assert.rejects(
      () =>
        resolveDeploymentInfisicalAdmittedReferences({
          requirements: [infisicalRequirement],
          targetScope: infisicalTargetScope,
          runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
          secretContext: context,
        }),
      /required secret contract .* is missing/,
    );
  } finally {
    await server.close();
  }
});

test("Infisical admission falls back to value read when metadata-only read omits exact version", async () => {
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_1",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/deployments/sample-webapp",
      secretName: "cloudflare_api_token",
      version: "7",
      secretValue: "sensitive-fallback-token",
      metadataResponse: { version: undefined },
    },
  ]);
  try {
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      secretContext: infisicalTestContext(server.siteUrl),
    });
    assert.equal(admitted[0]?.resolvedVersion, "7");
    assert.deepEqual(server.secretCalls, [
      "cloudflare_api_token:false:",
      "cloudflare_api_token:true:",
    ]);
    assert.ok(!JSON.stringify(admitted).includes("sensitive-fallback-token"));
  } finally {
    await server.close();
  }
});

test("Infisical fixture mode uses backend-qualified synthetic references", async () => {
  await withInfisicalFixtureFile(
    {
      [infisicalContractId]: {
        value: "fixture-token",
        version: "fixture-v1",
        allowedSteps: ["publish"],
        targetScopes: [infisicalTargetScope],
      },
    },
    async () => {
      const admitted = await resolveDeploymentInfisicalAdmittedReferences({
        requirements: [infisicalRequirement],
        targetScope: infisicalTargetScope,
      });
      assert.equal(admitted[0]?.referenceId, `infisical:fixture:${infisicalContractId}@fixture-v1`);
      const runtimeSecrets = createDeploymentSecretRuntime({
        backend: createDeploymentInfisicalSecretBackend(),
        admittedReferences: admitted,
        targetScope: infisicalTargetScope,
      });
      assert.equal(
        (await runtimeSecrets.enterStep("publish")).cloudflare_api_token,
        "fixture-token",
      );
    },
  );
});

test("Infisical replay mismatch fails without leaking secret values", async () => {
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_1",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/deployments/sample-webapp",
      secretName: "cloudflare_api_token",
      version: "3",
      secretValue: "sensitive-runtime-token",
    },
  ]);
  const context = infisicalTestContext(server.siteUrl);
  try {
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      secretContext: context,
    });
    server.secrets[0]!.id = "sec_2";
    const runtimeSecrets = createDeploymentSecretRuntime({
      backend: createDeploymentInfisicalSecretBackend(context),
      admittedReferences: admitted,
      targetScope: infisicalTargetScope,
    });
    await assert.rejects(
      () => runtimeSecrets.enterStep("publish"),
      (error) =>
        error instanceof Error &&
        /no longer resolves exactly for id/.test(error.message) &&
        !error.message.includes("sensitive-runtime-token"),
    );
  } finally {
    await server.close();
  }
});
