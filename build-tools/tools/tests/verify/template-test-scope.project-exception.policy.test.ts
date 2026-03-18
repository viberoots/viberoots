#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyTemplateTestScope } from "../../dev/verify/template-test-scope.ts";

test("project-local methodology exception changes stay on the project-impact verify path", async () => {
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
          changedPaths: ["projects/apps/pleomino/methodology-exceptions.json"],
          changedTemplateIds: [],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: [],
          safetyFloorTargets: [],
          templateTargetsById: {},
          selectedTargets: [],
        },
      }),
      resolveProjectImpactSelection: async () => ({
        mode: "project-impact",
        targets: ["//projects/apps/pleomino/..."],
        diagnostics: {
          mode: "project-impact",
          changedPaths: ["projects/apps/pleomino/methodology-exceptions.json"],
          changedProjects: ["projects/apps/pleomino"],
          dependentProjects: [],
          selectedTargets: ["//projects/apps/pleomino/..."],
          reason: "project-impact-selection",
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-impact");
  assert.deepEqual(result.targets, ["//projects/apps/pleomino/..."]);
  assert.equal(result.reason, "project-impact-targeted");
});
