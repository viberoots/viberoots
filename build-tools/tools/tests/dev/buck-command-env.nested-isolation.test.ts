#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
