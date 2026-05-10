#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buckCommandEnv,
  resolveNestedBuckIsolation,
  stableBuckIsolation,
  workspaceRootForBuckEnv,
} from "../../lib/buck-command-env";

test("buck command env helpers derive stable nested isolations from the workspace root", () => {
  const env = {
    WORKSPACE_ROOT: "/tmp/example-workspace",
  } as NodeJS.ProcessEnv;
  assert.equal(workspaceRootForBuckEnv(env), "/tmp/example-workspace");
  assert.equal(
    resolveNestedBuckIsolation({ env, prefix: "zxtest-shared" }).isolationDir,
    stableBuckIsolation("/tmp/example-workspace", "zxtest-shared"),
  );
});

test("buck command env helpers prefer inherited nested isolations", () => {
  const env = {
    WORKSPACE_ROOT: "/tmp/example-workspace",
    BUCK_NESTED_ISO: "already-set",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(resolveNestedBuckIsolation({ env, prefix: "zxtest-shared" }), {
    isolationDir: "already-set",
    ownsIsolation: false,
  });
});

test("buck command env gives nested buck daemons a full-suite startup budget", () => {
  const prevTimeout = process.env.BUCKD_STARTUP_TIMEOUT;
  const prevInitTimeout = process.env.BUCKD_STARTUP_INIT_TIMEOUT;
  try {
    delete process.env.BUCKD_STARTUP_TIMEOUT;
    delete process.env.BUCKD_STARTUP_INIT_TIMEOUT;
    const env = buckCommandEnv();
    assert.equal(env.BUCKD_STARTUP_TIMEOUT, "300");
    assert.equal(env.BUCKD_STARTUP_INIT_TIMEOUT, "300");
  } finally {
    if (typeof prevTimeout === "string") process.env.BUCKD_STARTUP_TIMEOUT = prevTimeout;
    else delete process.env.BUCKD_STARTUP_TIMEOUT;
    if (typeof prevInitTimeout === "string")
      process.env.BUCKD_STARTUP_INIT_TIMEOUT = prevInitTimeout;
    else delete process.env.BUCKD_STARTUP_INIT_TIMEOUT;
  }
});
