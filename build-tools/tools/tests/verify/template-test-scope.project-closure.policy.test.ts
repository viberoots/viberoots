#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyTemplateTestScope } from "../../dev/verify/template-test-scope.ts";

test("project-closure selector uses requested closure targets and scoped lint filters", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    requestedSelector: { mode: "project-closure", projects: ["projects/apps/tangram"] },
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//projects/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveProjectClosureSelection: async () => ({
        mode: "project-closure",
        targets: ["//projects/apps/tangram/...", "//projects/libs/ui/..."],
        diagnostics: {
          mode: "project-closure",
          requestedProjects: ["projects/apps/tangram"],
          resolvedDependencyClosure: ["projects/apps/tangram", "projects/libs/ui"],
          selectedTargets: ["//projects/apps/tangram/...", "//projects/libs/ui/..."],
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-closure");
  assert.equal(result.reason, "project-closure-targeted");
  assert.deepEqual(result.targets, ["//projects/apps/tangram/...", "//projects/libs/ui/..."]);
  assert.deepEqual(result.lintFilters, ["./projects/apps/tangram", "./projects/libs/ui"]);
});

test("project-closure selector preserves build-system fallback behavior", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    requestedSelector: { mode: "project-closure", projects: ["projects/apps/tangram"] },
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//..."],
        mode: "auto",
        hasBuildSystemChanges: true,
      }),
      resolveProjectClosureSelection: async () => ({
        mode: "project-closure",
        targets: ["//projects/apps/tangram/...", "//projects/libs/ui/..."],
        diagnostics: {
          mode: "project-closure",
          requestedProjects: ["projects/apps/tangram"],
          resolvedDependencyClosure: ["projects/apps/tangram", "projects/libs/ui"],
          selectedTargets: ["//projects/apps/tangram/...", "//projects/libs/ui/..."],
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-closure");
  assert.equal(result.reason, "fallback-build-system-scope");
  assert.deepEqual(result.targets, ["//..."]);
  assert.deepEqual(result.diagnostics, {
    mode: "project-closure",
    requestedProjects: ["projects/apps/tangram"],
    resolvedDependencyClosure: ["projects/apps/tangram", "projects/libs/ui"],
    selectedTargets: ["//..."],
    fallbackReason: "build-system-changes",
  });
});
