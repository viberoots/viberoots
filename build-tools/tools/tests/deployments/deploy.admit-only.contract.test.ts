#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

test("deploy --admit-only prints scoped admission evidence without deploying", async () => {
  await runInTemp("deploy-admit-only-evidence", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-dev:deploy --admit-only deploy/demo-dev`;
    const payload = JSON.parse(String(result.stdout));
    assert.deepEqual(
      payload.checks?.map((entry: { name: string }) => entry.name),
      ["deploy/demo-dev"],
    );
    assert.equal(payload.checks?.[0]?.subject, head);
    assert.equal(payload.checks?.[0]?.deploymentId, "demo-dev");
    assert.equal(payload.checks?.[0]?.environmentStage, "dev");
    assert.equal(
      payload.checks?.[0]?.admissionPolicyRef,
      "//sandbox/deployments/shared:dev_release",
    );
  });
});
