#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { prepareWorkerDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime-worker";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalRequirement, infisicalRuntime } from "./deployment-secret-infisical.fixture";
import { runInTemp } from "../lib/test-helpers";

test("Infisical-backed workers reject shared fixture secrets outside local fixture mode", async () => {
  await runInTemp("deploy-infisical-worker-fixture-rejection", async (tmp) => {
    const previousFixturePath = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    const previousLocalFixtureService = process.env.VBR_DEPLOY_LOCAL_FIXTURE_SERVICE;
    const fixturePath = path.join(tmp, "secret-fixture.json");
    await fsp.writeFile(fixturePath, "{}\n", "utf8");
    process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
    delete process.env.VBR_DEPLOY_LOCAL_FIXTURE_SERVICE;
    try {
      await assert.rejects(
        async () =>
          await prepareWorkerDeploymentSecretRuntime({
            workspaceRoot: tmp,
            deployment: {
              ...cloudflarePagesDeploymentFixture({
                secretRequirements: [infisicalRequirement],
              }),
              secretBackend: "infisical",
              infisicalRuntime,
            },
          }),
        /server-mode worker secret access must not use VBR_DEPLOYMENT_SECRET_FIXTURE_PATH/,
      );
    } finally {
      if (previousFixturePath === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
      else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previousFixturePath;
      if (previousLocalFixtureService === undefined)
        delete process.env.VBR_DEPLOY_LOCAL_FIXTURE_SERVICE;
      else process.env.VBR_DEPLOY_LOCAL_FIXTURE_SERVICE = previousLocalFixtureService;
    }
  });
});
