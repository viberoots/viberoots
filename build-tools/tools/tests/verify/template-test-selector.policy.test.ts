#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TEMPLATE_SAFETY_FLOOR_TARGETS,
  changedTemplateIdsFromPaths,
  classifyTemplateSelectorMode,
  resolveTemplateTestSelection,
  templateIdFromPath,
} from "../../lib/template-test-selector.ts";

test("template id extraction supports direct, delete, and rename paths", () => {
  assert.equal(
    templateIdFromPath("build-tools/tools/scaffolding/templates/go/lib/copier.yaml"),
    "go/lib",
  );
  assert.equal(
    templateIdFromPath("build-tools/tools/scaffolding/templates/ts/wasm-app/README.md.jinja"),
    "ts/wasm-app",
  );
  assert.equal(
    templateIdFromPath("build-tools/tools/scaffolding/templates/ts/README.md.jinja"),
    null,
  );
  assert.equal(templateIdFromPath("build-tools/tools/scaffolding/templates/go"), null);
  assert.equal(templateIdFromPath("docs/handbook/getting-started-on-a-pr.md"), null);
});

test("changed template id extraction is sorted and unique", () => {
  const ids = changedTemplateIdsFromPaths([
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/scaffolding/templates/ts/webapp-static/copier.yaml",
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/index.ts.jinja",
    "build-tools/tools/scaffolding/templates/go/lib/README.md.jinja",
  ]);
  assert.deepEqual(ids, ["go/lib", "ts/webapp-ssr-vite", "ts/webapp-static"]);
});

test("selector mode classification handles template-only, mixed, and no-template-impact", async () => {
  const templateOnly = await classifyTemplateSelectorMode(process.cwd(), [
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/scaffolding/templates/go/lib/README.md.jinja",
  ]);
  assert.equal(templateOnly.mode, "template-only");
  assert.deepEqual(templateOnly.changedTemplateIds, ["go/lib"]);
  assert.deepEqual(templateOnly.ownedChangedTestPaths, []);
  assert.deepEqual(templateOnly.ownedChangedTestTargets, []);
  assert.deepEqual(templateOnly.nonTemplateBuildSystemPaths, []);

  const mixed = await classifyTemplateSelectorMode(process.cwd(), [
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/dev/verify.ts",
  ]);
  assert.equal(mixed.mode, "mixed");
  assert.deepEqual(mixed.changedTemplateIds, ["go/lib"]);
  assert.deepEqual(mixed.ownedChangedTestPaths, []);
  assert.deepEqual(mixed.ownedChangedTestTargets, []);
  assert.deepEqual(mixed.nonTemplateBuildSystemPaths, ["build-tools/tools/dev/verify.ts"]);

  const noTemplate = await classifyTemplateSelectorMode(process.cwd(), [
    "projects/apps/myapp/src/index.ts",
    "docs/handbook/getting-started-on-a-pr.md",
  ]);
  assert.equal(noTemplate.mode, "no-template-impact");
  assert.deepEqual(noTemplate.changedTemplateIds, []);
  assert.deepEqual(noTemplate.ownedChangedTestPaths, []);
  assert.deepEqual(noTemplate.ownedChangedTestTargets, []);
});

test("template-only mode allows changed template-owned tests and selects changed test targets", async () => {
  const result = await resolveTemplateTestSelection({
    root: process.cwd(),
    changedPaths: [
      "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/index.ts.jinja",
      "build-tools/tools/tests/scaffolding/webapp-ssr-vite.runnable-contracts.test.ts",
    ],
    deps: {
      queryTargetsForTemplateLabel: async (_root, templateId) => {
        assert.equal(templateId, "ts/webapp-ssr-vite");
        return ["//:scaffolding_webapp_ssr_vite_baseline_contract"];
      },
    },
  });
  assert.equal(result.mode, "template-only");
  assert.deepEqual(result.diagnostics.ownedChangedTestPaths, [
    "build-tools/tools/tests/scaffolding/webapp-ssr-vite.runnable-contracts.test.ts",
  ]);
  assert.deepEqual(result.diagnostics.ownedChangedTestTargets, [
    "//:scaffolding_webapp_ssr_vite_runnable_contracts",
  ]);
  assert.ok(result.targets.includes("//:scaffolding_webapp_ssr_vite_runnable_contracts"));
});

test("template-only mode accepts template-support build-system files", async () => {
  const classification = await classifyTemplateSelectorMode(process.cwd(), [
    "build-tools/tools/scaffolding/templates/ts/webapp-static/copier.yaml",
    "build-tools/tools/tests/template_conventions.bzl",
    "build-tools/tools/tests/scaffolding/template-conventions.metadata.cquery.test.ts",
    "build-tools/tools/tests/scaffolding/lib/webapp-static-hmr.ts",
  ]);
  assert.equal(classification.mode, "template-only");
  assert.deepEqual(classification.changedTemplateIds, ["ts/webapp-static"]);
  assert.deepEqual(classification.nonTemplateBuildSystemPaths, []);
});

test("template-only selection unions label targets and safety floor", async () => {
  const result = await resolveTemplateTestSelection({
    root: process.cwd(),
    changedPaths: ["build-tools/tools/scaffolding/templates/go/lib/copier.yaml"],
    deps: {
      queryTargetsForTemplateLabel: async (_root, templateId) => {
        assert.equal(templateId, "go/lib");
        return ["//:z_target", "//:a_target", "//:a_target"];
      },
    },
  });
  assert.equal(result.mode, "template-only");
  assert.deepEqual(result.targets, [
    "//:a_target",
    "//:scaffolding_python_wasm_app_scaffold_smoke",
    "//:scaffolding_smoke_cli_readme",
    "//:scaffolding_smoke_lib_readme",
    "//:z_target",
  ]);
  assert.deepEqual(result.diagnostics.ownedChangedTestPaths, []);
  assert.deepEqual(result.diagnostics.ownedChangedTestTargets, []);
  assert.deepEqual(result.diagnostics.safetyFloorTargets, [...TEMPLATE_SAFETY_FLOOR_TARGETS]);
});

test("mixed and no-template-impact modes do not select narrowed targets", async () => {
  const mixed = await resolveTemplateTestSelection({
    root: process.cwd(),
    changedPaths: [
      "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
      "build-tools/tools/dev/verify.ts",
    ],
  });
  assert.equal(mixed.mode, "mixed");
  assert.deepEqual(mixed.targets, []);

  const none = await resolveTemplateTestSelection({
    root: process.cwd(),
    changedPaths: ["projects/apps/myapp/src/index.ts"],
  });
  assert.equal(none.mode, "no-template-impact");
  assert.deepEqual(none.targets, []);
});
