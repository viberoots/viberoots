#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_ENFORCEMENT_TARGETS } from "../../dev/verify/project-enforcement-selection";
import { resolveRequestedVerifyScope } from "../../dev/verify/requested-scope";
import { baseDecision, defaultArgs } from "./requested-scope.deployment.fixture";

test("shared selectors reuse one failed change result and select conservatively", async () => {
  let collections = 0;
  const failure = {
    ok: false as const,
    paths: [] as [],
    reason: "git status --porcelain=v1 failed: fixture unavailable",
  };
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      collectChangedPaths: async () => {
        collections++;
        return failure;
      },
      resolveTemplateScope: async (opts) => {
        assert.equal(opts.changedPathsResult, failure);
        return baseDecision({ targets: ["//..."] });
      },
      listDeploymentTargets: async () => {
        throw new Error("deployment selection must not rediscover failed changed paths");
      },
    },
  });
  assert.equal(collections, 1);
  assert.equal(result.selection.projectEnforcementReason, "unavailable-change-authority");
  assert.equal(result.selection.projectEnforcementChangeAuthorityFailure, failure.reason);
  assert.ok(result.selection.targets.includes("//..."));
  assert.ok(result.selection.targets.includes(PROJECT_ENFORCEMENT_TARGETS));
});

test("a successful shared empty result retains no-change project enforcement", async () => {
  let collections = 0;
  const empty = { ok: true as const, paths: [] };
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { VBR_DEPLOYMENT_TEST_SCOPE: "never" },
    deps: {
      collectChangedPaths: async () => {
        collections++;
        return empty;
      },
      resolveTemplateScope: async (opts) => {
        assert.equal(opts.changedPathsResult, empty);
        return baseDecision({ targets: ["//projects/..."] });
      },
    },
  });
  assert.equal(collections, 1);
  assert.equal(result.selection.projectEnforcementReason, "not-required");
  assert.equal(result.selection.targets.includes(PROJECT_ENFORCEMENT_TARGETS), false);
});

test("shared selectors receive unusual structural paths without rewriting", async () => {
  const paths = ['projects/app/ space\tline\nquote"backslash\\.ts ', "outside/rename-source\n.ts"];
  const changed = { ok: true as const, paths };
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { VBR_DEPLOYMENT_TEST_SCOPE: "never" },
    deps: {
      collectChangedPaths: async () => changed,
      resolveTemplateScope: async (opts) => {
        assert.equal(opts.changedPathsResult, changed);
        assert.deepEqual(opts.changedPathsResult.paths, paths);
        return baseDecision({ targets: ["//..."] });
      },
    },
  });
  assert.equal(result.selection.projectEnforcementReason, "project-change");
  assert.ok(result.selection.targets.includes(PROJECT_ENFORCEMENT_TARGETS));
});
