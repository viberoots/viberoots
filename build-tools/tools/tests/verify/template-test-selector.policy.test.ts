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
  assert.equal(templateIdFromPath("build-tools/tools/scaffolding/templates/go"), null);
  assert.equal(templateIdFromPath("docs/handbook/getting-started-on-a-pr.md"), null);
});

test("changed template id extraction is sorted and unique", () => {
  const ids = changedTemplateIdsFromPaths([
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/scaffolding/templates/node/webapp/copier.yaml",
    "build-tools/tools/scaffolding/templates/go/lib/README.md.jinja",
  ]);
  assert.deepEqual(ids, ["go/lib", "node/webapp"]);
});

test("selector mode classification handles template-only, mixed, and no-template-impact", () => {
  const templateOnly = classifyTemplateSelectorMode([
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/scaffolding/templates/go/lib/README.md.jinja",
  ]);
  assert.equal(templateOnly.mode, "template-only");
  assert.deepEqual(templateOnly.changedTemplateIds, ["go/lib"]);
  assert.deepEqual(templateOnly.nonTemplateBuildSystemPaths, []);

  const mixed = classifyTemplateSelectorMode([
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/dev/verify.ts",
  ]);
  assert.equal(mixed.mode, "mixed");
  assert.deepEqual(mixed.changedTemplateIds, ["go/lib"]);
  assert.deepEqual(mixed.nonTemplateBuildSystemPaths, ["build-tools/tools/dev/verify.ts"]);

  const noTemplate = classifyTemplateSelectorMode([
    "projects/apps/myapp/src/index.ts",
    "docs/handbook/getting-started-on-a-pr.md",
  ]);
  assert.equal(noTemplate.mode, "no-template-impact");
  assert.deepEqual(noTemplate.changedTemplateIds, []);
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
