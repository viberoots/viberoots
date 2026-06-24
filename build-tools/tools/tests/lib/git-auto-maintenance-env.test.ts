#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gitAutoMaintenanceDisabledEnvEntries,
  gitAutoMaintenanceDisabledTestEnvArgs,
  withGitAutoMaintenanceDisabledEnv,
} from "../../lib/git-auto-maintenance-env";

test("git auto-maintenance env disables automatic maintenance without dropping existing config", () => {
  const env = withGitAutoMaintenanceDisabledEnv({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "url.file:///tmp/repo/.insteadOf",
    GIT_CONFIG_VALUE_0: "git@example.invalid:",
  });

  assert.equal(env.GIT_CONFIG_COUNT, "4");
  assert.equal(env.GIT_CONFIG_KEY_0, "url.file:///tmp/repo/.insteadOf");
  assert.equal(env.GIT_CONFIG_VALUE_0, "git@example.invalid:");
  assert.equal(env.GIT_CONFIG_KEY_1, "maintenance.auto");
  assert.equal(env.GIT_CONFIG_VALUE_1, "false");
  assert.equal(env.GIT_CONFIG_KEY_2, "gc.auto");
  assert.equal(env.GIT_CONFIG_VALUE_2, "0");
  assert.equal(env.GIT_CONFIG_KEY_3, "gc.autoDetach");
  assert.equal(env.GIT_CONFIG_VALUE_3, "false");
});

test("git auto-maintenance env args are Buck test --env pairs", () => {
  assert.deepEqual(gitAutoMaintenanceDisabledEnvEntries({}), {
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "maintenance.auto",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "gc.auto",
    GIT_CONFIG_VALUE_1: "0",
    GIT_CONFIG_KEY_2: "gc.autoDetach",
    GIT_CONFIG_VALUE_2: "false",
  });
  assert.deepEqual(gitAutoMaintenanceDisabledTestEnvArgs({ GIT_CONFIG_COUNT: "1" }).slice(0, 2), [
    "--env",
    "GIT_CONFIG_COUNT=4",
  ]);
});
