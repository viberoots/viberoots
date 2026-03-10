#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyTemplateTestScope } from "../../dev/verify/template-test-scope.ts";

test("project-closure selector uses requested closure targets and scoped lint filters", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    requestedSelector: { mode: "project-closure", projects: ["workspace/apps/puzzle"] },
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//workspace/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveProjectClosureSelection: async () => ({
        mode: "project-closure",
        targets: ["//workspace/apps/puzzle/...", "//workspace/libs/ui/..."],
        diagnostics: {
          mode: "project-closure",
          requestedProjects: ["workspace/apps/puzzle"],
          resolvedDependencyClosure: ["workspace/apps/puzzle", "workspace/libs/ui"],
          selectedTargets: ["//workspace/apps/puzzle/...", "//workspace/libs/ui/..."],
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-closure");
  assert.equal(result.reason, "project-closure-targeted");
  assert.deepEqual(result.targets, ["//workspace/apps/puzzle/...", "//workspace/libs/ui/..."]);
  assert.deepEqual(result.lintFilters, ["./workspace/apps/puzzle", "./workspace/libs/ui"]);
});

test("project-closure selector preserves build-system fallback behavior", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    requestedSelector: { mode: "project-closure", projects: ["workspace/apps/puzzle"] },
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//..."],
        mode: "auto",
        hasBuildSystemChanges: true,
      }),
      resolveProjectClosureSelection: async () => ({
        mode: "project-closure",
        targets: ["//workspace/apps/puzzle/...", "//workspace/libs/ui/..."],
        diagnostics: {
          mode: "project-closure",
          requestedProjects: ["workspace/apps/puzzle"],
          resolvedDependencyClosure: ["workspace/apps/puzzle", "workspace/libs/ui"],
          selectedTargets: ["//workspace/apps/puzzle/...", "//workspace/libs/ui/..."],
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-closure");
  assert.equal(result.reason, "fallback-build-system-scope");
  assert.deepEqual(result.targets, ["//..."]);
  assert.deepEqual(result.diagnostics, {
    mode: "project-closure",
    requestedProjects: ["workspace/apps/puzzle"],
    resolvedDependencyClosure: ["workspace/apps/puzzle", "workspace/libs/ui"],
    selectedTargets: ["//..."],
    fallbackReason: "build-system-changes",
  });
});
