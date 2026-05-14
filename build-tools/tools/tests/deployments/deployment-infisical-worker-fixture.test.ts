#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { prepareWorkerDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime-worker";
import { workerSecretRuntimeMetadata } from "../../deployments/deployment-secret-worker-runtime-metadata";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalRequirement, infisicalRuntime } from "./deployment-secret-infisical.fixture";
import { runInTemp } from "../lib/test-helpers";

const fixtureValue = "fixture-token-must-not-leak";

function restoreEnv(previousFixturePath?: string, previousLocalFixtureService?: string) {
  if (previousFixturePath === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previousFixturePath;
  if (previousLocalFixtureService === undefined) delete process.env[LOCAL_FIXTURE_SERVICE_ENV];
  else process.env[LOCAL_FIXTURE_SERVICE_ENV] = previousLocalFixtureService;
}

function infisicalWorkerDeployment() {
  return {
    ...cloudflarePagesDeploymentFixture({
      secretRequirements: [infisicalRequirement],
    }),
    secretBackend: "infisical" as const,
    infisicalRuntime,
  };
}

async function withFixturePath(tmp: string, run: () => Promise<void>) {
  const previousFixturePath = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  const previousLocalFixtureService = process.env[LOCAL_FIXTURE_SERVICE_ENV];
  const fixturePath = path.join(tmp, "secret-fixture.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({
      schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
      contracts: { [infisicalRequirement.contractId]: { value: fixtureValue } },
    }),
  );
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  try {
    await run();
  } finally {
    restoreEnv(previousFixturePath, previousLocalFixtureService);
  }
}

test("Infisical-backed workers reject shared fixture secrets outside local fixture mode", async () => {
  await runInTemp("deploy-infisical-worker-fixture-rejection", async (tmp) => {
    await withFixturePath(tmp, async () => {
      delete process.env[LOCAL_FIXTURE_SERVICE_ENV];
      await assert.rejects(
        async () =>
          await prepareWorkerDeploymentSecretRuntime({
            workspaceRoot: tmp,
            deployment: infisicalWorkerDeployment(),
          }),
        /server-mode worker secret access must not use VBR_DEPLOYMENT_SECRET_FIXTURE_PATH/,
      );
      for (const value of ["false", "true", "yes"]) {
        process.env[LOCAL_FIXTURE_SERVICE_ENV] = value;
        await assert.rejects(
          () =>
            prepareWorkerDeploymentSecretRuntime({
              workspaceRoot: tmp,
              deployment: infisicalWorkerDeployment(),
            }),
          /server-mode worker secret access must not use VBR_DEPLOYMENT_SECRET_FIXTURE_PATH/,
        );
      }
    });
  });
});

test("Infisical-backed workers accept fixture secrets only for exact local fixture marker", async () => {
  await runInTemp("deploy-infisical-worker-fixture-service", async (tmp) => {
    await withFixturePath(tmp, async () => {
      process.env[LOCAL_FIXTURE_SERVICE_ENV] = "1";
      const prepared = await prepareWorkerDeploymentSecretRuntime({
        workspaceRoot: tmp,
        deployment: infisicalWorkerDeployment(),
      });
      assert.deepEqual(prepared, { minted: false });
      assert.doesNotMatch(JSON.stringify(prepared), /secret-fixture|fixture-token/);
    });
  });
});

test("Infisical fixture-service worker outputs do not expose fixture material", async () => {
  await runInTemp("deploy-infisical-worker-fixture-redaction", async (tmp) => {
    await withFixturePath(tmp, async () => {
      const fixturePath = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] || "";
      const logs: string[] = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;
      console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));
      console.warn = (...values: unknown[]) => logs.push(values.map(String).join(" "));
      console.error = (...values: unknown[]) => logs.push(values.map(String).join(" "));
      try {
        process.env[LOCAL_FIXTURE_SERVICE_ENV] = "true";
        let rejectionMessage = "";
        try {
          await prepareWorkerDeploymentSecretRuntime({
            workspaceRoot: tmp,
            deployment: infisicalWorkerDeployment(),
          });
        } catch (error) {
          rejectionMessage = error instanceof Error ? error.message : String(error);
        }
        process.env[LOCAL_FIXTURE_SERVICE_ENV] = "1";
        const prepared = await prepareWorkerDeploymentSecretRuntime({
          workspaceRoot: tmp,
          deployment: infisicalWorkerDeployment(),
        });
        const diagnostics = workerSecretRuntimeMetadata({
          deployment: infisicalWorkerDeployment(),
        });
        const record = {
          workerRuntime: prepared,
          workerDiagnostics: diagnostics,
          rejectionMessage,
          logs,
        };
        const output = JSON.stringify(record);
        assert.match(rejectionMessage, /VBR_DEPLOYMENT_SECRET_FIXTURE_PATH/);
        for (const secret of [fixturePath, fixtureValue]) {
          assert.ok(secret);
          assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.doesNotMatch(
            rejectionMessage,
            new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          );
        }
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    });
  });
});
