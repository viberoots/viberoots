#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "../../deployments/deployment-secret-admission";
import { createDeploymentSecretRuntimeForAdmittedContext } from "../../deployments/deployment-secret-runtime-helpers";
import type { DeploymentSecretAdmittedReference } from "../../deployments/deployment-sprinkle-ref";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalTestContext,
  infisicalTargetScope,
  withInfisicalFixtureFile,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

function recordedReference(
  backend: DeploymentSecretAdmittedReference["backend"],
): DeploymentSecretAdmittedReference {
  return {
    name: "cloudflare_api_token",
    step: "publish",
    contractId: infisicalRequirement.contractId,
    required: true,
    backend,
    referenceId: `${backend}:${infisicalRequirement.contractId}@1`,
    targetScope: infisicalTargetScope,
    backendRef: infisicalRequirement.contractId,
    selectorRef: `${infisicalRequirement.contractId}@1`,
    resolvedVersion: "1",
    resolvedAt: "2026-05-13T00:00:00.000Z",
    refreshMode: "none",
    credentialClass: "routine",
  };
}

test("initial admission defaults to Vault and honors explicit Vault", async () => {
  await withInfisicalFixtureFile(
    { [infisicalRequirement.contractId]: { value: "fixture-token", version: "1" } },
    async () => {
      for (const secretBackend of [undefined, "vault" as const]) {
        const admitted = await resolveInitialAdmittedSecretReferences({
          requirements: [infisicalRequirement],
          targetScope: infisicalTargetScope,
          secretBackend,
          secretContext: { kind: "fixture" },
        });
        assert.equal(admitted[0]?.backend, "vault");
        assert.match(admitted[0]?.referenceId || "", /^vault:/);
      }
    },
  );
});

test("initial admission dispatches to Infisical and records non-secret selectors", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [
      {
        id: "sec_1",
        projectId: "proj_123",
        environment: "prod",
        secretPath: "/deployments/sample-webapp",
        secretName: "cloudflare_api_token",
        version: "3",
        secretValue: "runtime-token-v3",
      },
    ],
  );
  try {
    const admitted = await resolveInitialAdmittedSecretReferences({
      requirements: [infisicalRequirement],
      targetScope: infisicalTargetScope,
      secretBackend: "infisical",
      infisicalRuntime: { ...infisicalRuntime, siteUrl: server.siteUrl },
      secretContext: infisicalTestContext(server.siteUrl),
    });
    assert.equal(admitted[0]?.backend, "infisical");
    assert.match(admitted[0]?.referenceId || "", /^infisical:/);
    assert.doesNotMatch(JSON.stringify(admitted), /runtime-token-v3|secret-value/i);
  } finally {
    await server.close();
  }
});

test("source-run replay keeps recorded backend references across metadata migration", async () => {
  const recordedVault = recordedReference("vault");
  const replayed = await resolveSourceRunAdmittedSecretReferences({
    sourceAdmittedContext: { admittedSecretReferences: [recordedVault] },
    requirements: [infisicalRequirement],
    targetScope: infisicalTargetScope,
  });
  assert.deepEqual(replayed, [recordedVault]);

  const runtime = createDeploymentSecretRuntimeForAdmittedContext({
    admittedContext: {
      secretBackend: "infisical",
      admittedSecretReferences: replayed,
      targetEnvironment: { lockScope: infisicalTargetScope },
    },
  });
  await assert.rejects(() => runtime.enterStep("publish"), /explicit deployment secret context/);
});

test("source-run replay rejects non-exact recorded secret references", async () => {
  await assert.rejects(
    () =>
      resolveSourceRunAdmittedSecretReferences({
        sourceAdmittedContext: {
          admittedSecretReferences: [
            {
              name: "cloudflare_api_token",
              step: "publish",
              contractId: infisicalRequirement.contractId,
              required: true,
              backend: "infisical",
              referenceId: `infisical:${infisicalRequirement.contractId}`,
            },
          ],
        },
        requirements: [infisicalRequirement],
        targetScope: infisicalTargetScope,
      }),
    /exact recorded admitted backend references/,
  );
});
