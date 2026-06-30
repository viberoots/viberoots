#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsToolScript } from "./deployment-command";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";

test("deploy --list still consumes the existing deployment contract shape", async () => {
  await runInTemp("resource-envelope-deploy-list-compat", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --list`;
    const payload = JSON.parse(String(result.stdout));
    assert.equal(payload.schemaVersion, "deploy-list@1");
    assert.deepEqual(payload.deployments, [
      {
        deploymentId: "demo-dev",
        label: "//sandbox/deployments/demo-dev:deploy",
        provider: "nixos-shared-host",
        protectionClass: "shared_nonprod",
        environmentStage: "dev",
        providerTargetIdentity: "nixos-shared-host:default:demo",
      },
    ]);
    assert.equal(JSON.stringify(payload).includes("deployment.resource.viberoots.dev/v1"), false);
    assert.equal(JSON.stringify(payload).includes("statusRef"), false);
  });
});
