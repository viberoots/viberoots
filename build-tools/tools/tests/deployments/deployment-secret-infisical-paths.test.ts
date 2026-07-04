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
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const auth = { clientId: "id", clientSecret: "secret", accessToken: "token" };

async function admittedSelector(opts: {
  runtimePath?: string;
  prefix?: string;
  mappingPath?: string;
  expectedPath: string;
}) {
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_path",
      projectId: "proj_123",
      environment: "prod",
      secretPath: opts.expectedPath,
      secretName: opts.mappingPath ? "mapped-token" : "cloudflare_api_token",
      version: "7",
    },
  ]);
  try {
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: {
        ...infisicalRuntime,
        siteUrl: server.siteUrl,
        ...(opts.runtimePath !== undefined ? { secretPath: opts.runtimePath } : {}),
        ...(opts.prefix !== undefined ? { secretPathPrefix: opts.prefix } : {}),
      },
      ...(opts.mappingPath
        ? {
            mappings: {
              [infisicalContractId]: {
                secretPath: opts.mappingPath,
                secretName: "mapped-token",
              },
            },
          }
        : {}),
      secretContext: infisicalTestContext(server.siteUrl),
    });
    return admitted[0]!;
  } finally {
    await server.close();
  }
}

test("Infisical selector applies runtime secret path prefix without mapping override", async () => {
  const admitted = await admittedSelector({
    runtimePath: "/deployments",
    prefix: "/sample-webapp/",
    expectedPath: "/deployments/sample-webapp",
  });
  assert.equal(
    admitted.selectorRef,
    "proj_123:prod:/deployments/sample-webapp:cloudflare_api_token@7",
  );
  assert.equal(
    admitted.backendRef,
    "proj_123:prod:/deployments/sample-webapp:cloudflare_api_token#sec_path",
  );
  assert.equal(
    admitted.referenceId,
    "infisical:proj_123:prod:/deployments/sample-webapp:cloudflare_api_token#sec_path@7",
  );
});

test("Infisical selector mapping path overrides runtime prefix", async () => {
  const admitted = await admittedSelector({
    runtimePath: "/deployments",
    prefix: "ignored",
    mappingPath: "/shared/cloudflare/",
    expectedPath: "/shared/cloudflare",
  });
  assert.equal(admitted.selectorRef, "proj_123:prod:/shared/cloudflare:mapped-token@7");
});

test("Infisical selector normalizes empty and duplicate path separators", async () => {
  for (const [runtimePath, prefix, expectedPath] of [
    ["", "", "/"],
    ["/", "/", "/"],
    ["/deployments/", "/sample-webapp/", "/deployments/sample-webapp"],
    ["deployments//", "//sample-webapp/cloudflare//", "/deployments/sample-webapp/cloudflare"],
  ] as const) {
    const admitted = await admittedSelector({ runtimePath, prefix, expectedPath });
    assert.equal(admitted.selectorRef, `proj_123:prod:${expectedPath}:cloudflare_api_token@7`);
  }
});

test("Infisical runtime acquire uses admitted prefixed selector and version", async () => {
  const expectedPath = "/deployments/sample-webapp";
  const server = await startFakeInfisicalServer(auth, [
    {
      id: "sec_prefixed",
      projectId: "proj_123",
      environment: "prod",
      secretPath: expectedPath,
      secretName: "cloudflare_api_token",
      version: "7",
      reference: "prefixed-ref",
      secretValue: "runtime-token-v7",
    },
    {
      id: "sec_unprefixed",
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/deployments",
      secretName: "cloudflare_api_token",
      version: "7",
      reference: "unprefixed-ref",
      secretValue: "wrong-path-token",
    },
  ]);
  try {
    const context = infisicalTestContext(server.siteUrl);
    const admitted = await resolveDeploymentInfisicalAdmittedReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      runtime: {
        ...infisicalRuntime,
        siteUrl: server.siteUrl,
        secretPath: "/deployments",
        secretPathPrefix: "sample-webapp",
      },
      secretContext: context,
    });
    assert.equal(
      admitted[0]?.backendRef,
      "proj_123:prod:/deployments/sample-webapp:cloudflare_api_token#id=sec_prefixed&reference=prefixed-ref",
    );
    assert.equal(
      admitted[0]?.selectorRef,
      "proj_123:prod:/deployments/sample-webapp:cloudflare_api_token@7",
    );
    const runtime = createDeploymentSecretRuntime({
      backend: createDeploymentInfisicalSecretBackend(context),
      admittedReferences: admitted,
      targetScope: infisicalTargetScope,
    });
    assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "runtime-token-v7");
    assert.deepEqual(server.secretCalls, [
      "cloudflare_api_token:false:",
      "cloudflare_api_token:true:7",
    ]);
  } finally {
    await server.close();
  }
});
