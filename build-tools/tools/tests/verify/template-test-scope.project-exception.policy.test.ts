#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyTemplateTestScope } from "../../dev/verify/template-test-scope";

test("project-local methodology exception changes stay on the project-impact verify path", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//workspace/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => ({
        mode: "no-template-impact",
        targets: [],
        diagnostics: {
          mode: "no-template-impact",
          changedPaths: ["workspace/apps/demoapp/methodology-exceptions.json"],
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
        targets: ["//workspace/apps/demoapp/..."],
        diagnostics: {
          mode: "project-impact",
          changedPaths: ["workspace/apps/demoapp/methodology-exceptions.json"],
          changedProjects: ["workspace/apps/demoapp"],
          dependentProjects: [],
          selectedTargets: ["//workspace/apps/demoapp/..."],
          reason: "project-impact-selection",
        },
      }),
    },
  });

  assert.equal(result.selectorMode, "project-impact");
  assert.deepEqual(result.targets, ["//workspace/apps/demoapp/..."]);
  assert.equal(result.reason, "project-impact-targeted");
});
