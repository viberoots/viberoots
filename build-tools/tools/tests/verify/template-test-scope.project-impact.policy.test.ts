#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyTemplateTestScope } from "../../dev/verify/template-test-scope.ts";

test("auto mode uses project-impact targets for app/lib-only changes", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//projects/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => ({
        mode: "no-template-impact",
        targets: [],
        diagnostics: {
          mode: "no-template-impact",
          changedPaths: ["projects/apps/myapp/src/index.ts"],
          changedTemplateIds: [],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: [],
          safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
          templateTargetsById: {},
          selectedTargets: [],
        },
      }),
      resolveProjectImpactSelection: async () => ({
        mode: "project-impact",
        targets: ["//projects/apps/myapp/..."],
        diagnostics: {
          mode: "project-impact",
          changedPaths: ["projects/apps/myapp/src/index.ts"],
          changedProjects: ["projects/apps/myapp"],
          dependentProjects: [],
          selectedTargets: ["//projects/apps/myapp/..."],
          reason: "project-impact-selection",
        },
      }),
    },
  });
  assert.equal(result.selectorMode, "project-impact");
  assert.equal(result.reason, "project-impact-targeted");
  assert.deepEqual(result.targets, ["//projects/apps/myapp/..."]);
});

test("project-impact input ignores dirty .vite-cache paths", async () => {
  let receivedChangedPaths: string[] = [];
  await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//projects/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => ({
        mode: "no-template-impact",
        targets: [],
        diagnostics: {
          mode: "no-template-impact",
          changedPaths: [
            "projects/apps/myapp/src/index.ts",
            "projects/apps/myapp/.vite-cache/dep.js",
          ],
          changedTemplateIds: [],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: [],
          safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
          templateTargetsById: {},
          selectedTargets: [],
        },
      }),
      resolveProjectImpactSelection: async (opts: { changedPaths: string[] }) => {
        const changedPaths = opts.changedPaths;
        receivedChangedPaths = [...changedPaths];
        return {
          mode: "project-impact",
          targets: ["//projects/apps/myapp/..."],
          diagnostics: {
            mode: "project-impact",
            changedPaths,
            changedProjects: ["projects/apps/myapp"],
            dependentProjects: [],
            selectedTargets: ["//projects/apps/myapp/..."],
            reason: "project-impact-selection",
          },
        };
      },
    },
  });
  assert.deepEqual(receivedChangedPaths, ["projects/apps/myapp/src/index.ts"]);
});

test("project-impact fallback keeps existing build-system scope", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//projects/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => ({
        mode: "no-template-impact",
        targets: [],
        diagnostics: {
          mode: "no-template-impact",
          changedPaths: ["projects/apps/myapp/src/index.ts"],
          changedTemplateIds: [],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: [],
          safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
          templateTargetsById: {},
          selectedTargets: [],
        },
      }),
      resolveProjectImpactSelection: async () => ({
        mode: "fallback-build-system-scope",
        targets: [],
        diagnostics: {
          mode: "fallback-build-system-scope",
          changedPaths: ["projects/apps/myapp/src/index.ts"],
          changedProjects: ["projects/apps/myapp"],
          dependentProjects: [],
          selectedTargets: [],
          reason: "graph-read-failed",
        },
      }),
    },
  });
  assert.equal(result.selectorMode, "no-template-impact");
  assert.equal(result.reason, "fallback-build-system-scope");
  assert.deepEqual(result.targets, ["//projects/..."]);
});
