#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRequestedVerifyScope } from "../../dev/verify/requested-scope";
import type { VerifyArgs } from "../../dev/verify/args";

const defaultArgs: VerifyArgs = {
  coverage: false,
  console: "auto",
  targets: ["//..."],
  selector: "default",
  requestedProjects: [],
  explainSelection: false,
};

test("ALL_TESTS forces the default verify selector to all Buck tests", async () => {
  const resolved = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { ALL_TESTS: "1" },
    deps: {
      resolveTemplateScope: async () => {
        throw new Error("template scope should be bypassed");
      },
    },
  });

  assert.equal(resolved.selection.selectorMode, "all-tests");
  assert.equal(resolved.selection.reason, "all-tests-env");
  assert.deepEqual(resolved.selection.targets, ["//..."]);
});

test("ALL_TESTS=true is accepted as the all-tests override", async () => {
  const resolved = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { ALL_TESTS: "true", VBR_DEPLOYMENT_TEST_SCOPE: "never" },
    deps: {
      resolveTemplateScope: async () => {
        throw new Error("template scope should be bypassed");
      },
    },
  });

  assert.equal(resolved.selection.selectorMode, "all-tests");
  assert.equal(resolved.selection.requestedDeploymentMode, "never");
  assert.deepEqual(resolved.selection.targets, ["//..."]);
});
