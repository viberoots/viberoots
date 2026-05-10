#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveVerifyTemplateTestScope,
  summarizeTemplateScopeDecision,
} from "../../dev/verify/template-test-scope";

test("auto mode uses template-selected targets for template-only changes", async () => {
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
        mode: "template-only",
        targets: ["//:a_template_test", "//:scaffolding_smoke_lib_readme"],
        diagnostics: {
          mode: "template-only",
          changedPaths: ["build-tools/tools/scaffolding/templates/go/lib/copier.yaml"],
          changedTemplateIds: ["go/lib"],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: [],
          safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
          templateTargetsById: {
            "go/lib": ["//:a_template_test"],
          },
          selectedTargets: ["//:a_template_test", "//:scaffolding_smoke_lib_readme"],
        },
      }),
    },
  });
  assert.equal(result.selectorMode, "template-only");
  assert.deepEqual(result.targets, ["//:a_template_test", "//:scaffolding_smoke_lib_readme"]);
  assert.deepEqual(result.lintFilters, ["."]);
});

test("auto mode falls back to build-system scope when selector reports mixed", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//..."],
        mode: "auto",
        hasBuildSystemChanges: true,
      }),
      resolveTemplateSelection: async () => ({
        mode: "mixed",
        targets: [],
        diagnostics: {
          mode: "mixed",
          changedPaths: [
            "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
            "build-tools/tools/dev/verify.ts",
          ],
          changedTemplateIds: ["go/lib"],
          ownedChangedTestPaths: [],
          ownedChangedTestTargets: [],
          nonTemplateBuildSystemPaths: ["build-tools/tools/dev/verify.ts"],
          safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
          templateTargetsById: { "go/lib": [] },
          selectedTargets: [],
        },
      }),
    },
  });
  assert.equal(result.selectorMode, "mixed");
  assert.deepEqual(result.targets, ["//..."]);
  assert.equal(result.lintFilters, null);
});

test("never mode bypasses selector path and keeps existing build-system scope", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: { VBR_TEMPLATE_TEST_SCOPE: "never" },
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//workspace/..."],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => {
        throw new Error("selector should not be called in never mode");
      },
    },
  });
  assert.equal(result.selectorMode, "skipped");
  assert.deepEqual(result.targets, ["//workspace/..."]);
});

test("never mode preserves full build-system scope when build-system tests are forced always", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//..."],
    env: { VBR_TEMPLATE_TEST_SCOPE: "never", VBR_BUILD_SYSTEM_TESTS: "always" },
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//..."],
        mode: "always",
        hasBuildSystemChanges: false,
      }),
      resolveTemplateSelection: async () => {
        throw new Error("selector should not be called when never mode preserves forced scope");
      },
    },
  });
  assert.equal(result.selectorMode, "skipped");
  assert.equal(result.reason, "selector-disabled");
  assert.deepEqual(result.targets, ["//..."]);
});

test("selection summary reports target selector counts rather than expanded test counts", () => {
  assert.equal(
    summarizeTemplateScopeDecision({
      requestedMode: "never",
      selectorMode: "skipped",
      targets: ["//..."],
      diagnostics: null,
      lintFilters: null,
      reason: "selector-disabled",
    }),
    "requested=never selector=skipped reason=selector-disabled targetSelectors=1",
  );
});

test("explicit project target scopes lint/prettier to that importer", async () => {
  const result = await resolveVerifyTemplateTestScope({
    root: process.cwd(),
    requestedTargets: ["//workspace/apps/my-app:app"],
    env: {},
    deps: {
      resolveBuildScope: async () => ({
        targets: ["//workspace/apps/my-app:app"],
        mode: "auto",
        hasBuildSystemChanges: false,
      }),
    },
  });
  assert.equal(result.selectorMode, "skipped");
  assert.deepEqual(result.targets, ["//workspace/apps/my-app:app"]);
  assert.deepEqual(result.lintFilters, ["./workspace/apps/my-app"]);
});

test("always mode fails with actionable diagnostics when change-set is not template-only", async () => {
  await assert.rejects(
    async () =>
      resolveVerifyTemplateTestScope({
        root: process.cwd(),
        requestedTargets: ["//..."],
        env: { VBR_TEMPLATE_TEST_SCOPE: "always" },
        deps: {
          resolveBuildScope: async () => ({
            targets: ["//..."],
            mode: "auto",
            hasBuildSystemChanges: true,
          }),
          resolveTemplateSelection: async () => ({
            mode: "no-template-impact",
            targets: [],
            diagnostics: {
              mode: "no-template-impact",
              changedPaths: ["workspace/apps/myapp/src/index.ts"],
              changedTemplateIds: [],
              ownedChangedTestPaths: [],
              ownedChangedTestTargets: [],
              nonTemplateBuildSystemPaths: [],
              safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
              templateTargetsById: {},
              selectedTargets: [],
            },
          }),
        },
      }),
    /VBR_TEMPLATE_TEST_SCOPE=always requires template-only changes/,
  );
});

test("template-only mode fails when a changed template id has no label-selected Buck targets", async () => {
  await assert.rejects(
    async () =>
      resolveVerifyTemplateTestScope({
        root: process.cwd(),
        requestedTargets: ["//..."],
        env: {},
        deps: {
          resolveBuildScope: async () => ({
            targets: ["//..."],
            mode: "auto",
            hasBuildSystemChanges: true,
          }),
          resolveTemplateSelection: async () => ({
            mode: "template-only",
            targets: ["//:scaffolding_smoke_lib_readme"],
            diagnostics: {
              mode: "template-only",
              changedPaths: ["build-tools/tools/scaffolding/templates/go/lib/copier.yaml"],
              changedTemplateIds: ["go/lib"],
              ownedChangedTestPaths: [],
              ownedChangedTestTargets: [],
              nonTemplateBuildSystemPaths: [],
              safetyFloorTargets: ["//:scaffolding_smoke_lib_readme"],
              templateTargetsById: { "go/lib": [] },
              selectedTargets: ["//:scaffolding_smoke_lib_readme"],
            },
          }),
        },
      }),
    /emptyTemplateIds=go\/lib/,
  );
});
