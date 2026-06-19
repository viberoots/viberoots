#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deploymentBuckEnv,
  deploymentIsolationArgs,
} from "../../deployments/deployment-query-helpers";
import { stableBuckIsolation } from "../../lib/buck-command-env";

test("deployment cquery env derives stable isolation from workspace root", () => {
  const workspaceRoot = "/tmp/viberoots-deployment-query";
  const env = deploymentBuckEnv(workspaceRoot, { HOME: "/tmp/home" });

  assert.equal(env.BUCK_NESTED_ISO, stableBuckIsolation(workspaceRoot, "deployment-query"));
  assert.deepEqual(deploymentIsolationArgs(env), [
    "--isolation-dir",
    stableBuckIsolation(workspaceRoot, "deployment-query"),
  ]);
});

test("deployment cquery env preserves inherited isolation controls", () => {
  const env = deploymentBuckEnv("/tmp/viberoots-deployment-query", {
    HOME: "/tmp/home",
    BUCK_ISOLATION_DIR_EXPORTER: "already-owned",
  });

  assert.equal(env.BUCK_NESTED_ISO, undefined);
  assert.deepEqual(deploymentIsolationArgs(env), ["--isolation-dir", "already-owned"]);
});

test("deployment cquery env preserves caller-owned nested isolation", () => {
  const env = deploymentBuckEnv("/tmp/viberoots-deployment-query", {
    HOME: "/tmp/home",
    BUCK_NESTED_ISO: "caller-owned",
  });

  assert.equal(env.BUCK_NESTED_ISO, "caller-owned");
  assert.deepEqual(deploymentIsolationArgs(env), ["--isolation-dir", "caller-owned"]);
});

test("deployment cquery env respects explicit no-isolation mode", () => {
  const env = deploymentBuckEnv("/tmp/viberoots-deployment-query", {
    HOME: "/tmp/home",
    BUCK_NO_ISOLATION: "1",
  });

  assert.equal(env.BUCK_NESTED_ISO, undefined);
  assert.deepEqual(deploymentIsolationArgs(env), []);
});
