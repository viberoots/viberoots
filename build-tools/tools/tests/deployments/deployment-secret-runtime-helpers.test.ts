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
import { createDeploymentSecretRuntimeForAdmittedContext } from "../../deployments/deployment-secret-runtime-helpers";
import type { DeploymentSecretAdmittedReference } from "../../deployments/deployment-sprinkle-ref";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";

const originalEnv = { ...process.env };
const targetScope = "cloudflare-pages:web-platform-staging/pleomino-staging-pages";
const contractId = "secret://deployments/pleomino/cloudflare_api_token";

function restoreEnv() {
  process.env = { ...originalEnv };
}

async function withFixture(run: () => Promise<void>) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-secret-runtime-helpers-"));
  const fixturePath = path.join(tmp, "secret-fixture.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify(
      {
        schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
        contracts: {
          [contractId]: {
            value: "fixture-token",
            allowedSteps: ["publish"],
            targetScopes: [targetScope],
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  try {
    await run();
  } finally {
    restoreEnv();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function admittedReference(
  backend: DeploymentSecretAdmittedReference["backend"],
): DeploymentSecretAdmittedReference {
  return {
    name: "cloudflare_api_token",
    step: "publish",
    contractId,
    required: true,
    backend,
    referenceId: `${backend}:${contractId}`,
    targetScope,
    backendRef: contractId,
    selectorRef: contractId,
    resolvedAt: "2026-05-13T00:00:00.000Z",
    refreshMode: "none",
    credentialClass: "routine",
  };
}

test("neutral runtime defaults to the registered Vault backend", async () => {
  await withFixture(async () => {
    const runtime = createDeploymentSecretRuntimeForAdmittedContext({
      admittedContext: {
        secretRequirements: [
          deploymentRequirementFixture({
            name: "cloudflare_api_token",
            step: "publish",
            contractId,
          }),
        ],
        targetEnvironment: { lockScope: targetScope },
      },
    });

    assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "fixture-token");
  });
});

test("admitted references choose Vault even when current metadata says Infisical", async () => {
  await withFixture(async () => {
    const runtime = createDeploymentSecretRuntimeForAdmittedContext({
      admittedContext: {
        secretBackend: "infisical",
        admittedSecretReferences: [admittedReference("vault")],
        targetEnvironment: { lockScope: targetScope },
      },
    });

    assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "fixture-token");
  });
});

test("neutral runtime selects Infisical and fails closed without its secret context", async () => {
  const runtime = createDeploymentSecretRuntimeForAdmittedContext({
    admittedContext: {
      secretBackend: "infisical",
      secretRequirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId,
        }),
      ],
      targetEnvironment: { lockScope: targetScope },
    },
  });
  await assert.rejects(
    async () => await runtime.enterStep("publish"),
    /explicit deployment secret context/,
  );
});

test("neutral runtime rejects mixed admitted secret backends", () => {
  assert.throws(
    () =>
      createDeploymentSecretRuntimeForAdmittedContext({
        admittedContext: {
          admittedSecretReferences: [admittedReference("vault"), admittedReference("infisical")],
        },
      }),
    /cannot mix backends.*vault, infisical/,
  );
});
