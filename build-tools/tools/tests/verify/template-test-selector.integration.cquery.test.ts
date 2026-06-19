#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { buckCommandEnv, resolveNestedBuckIsolation } from "../../lib/buck-command-env";
import {
  TEMPLATE_SAFETY_FLOOR_TARGETS,
  resolveTemplateTestSelection,
} from "../../lib/template-test-selector";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;
const { isolationDir: templateSelectorIsolation, ownsIsolation: ownsTemplateSelectorIsolation } =
  resolveNestedBuckIsolation({ prefix: "template-selector" });
const buckEnv = { ...buckCommandEnv(), IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" };

function normalizeTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  if (clean.startsWith("root//")) return clean.slice("root".length);
  return clean;
}

async function queryTemplateLabelTargets(templateId: string): Promise<string[]> {
  const query = `attrfilter(labels, "template:${templateId}", //...)`;
  const targetPlatform =
    String(process.env.BUCK_TARGET_PLATFORMS || process.env.BUCK_TARGET_PLATFORM || "").trim() ||
    "prelude//platforms:default";
  const out = await $({
    stdio: "pipe",
    env: buckEnv,
  })`buck2 --isolation-dir ${templateSelectorIsolation} cquery --target-platforms ${targetPlatform} ${query} --json --output-attribute name`;
  const raw = JSON.parse(String(out.stdout || "{}")) as Record<string, { name?: string }>;
  return Array.from(new Set(Object.keys(raw).map((k) => normalizeTarget(k)))).sort();
}

test("selector output matches Buck template label query results", async () => {
  try {
    const changedPaths = [
      "viberoots/build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
      "viberoots/build-tools/tools/scaffolding/templates/ts/lib/copier.yaml",
    ];
    const result = await resolveTemplateTestSelection({
      root: process.cwd(),
      changedPaths,
    });

    assert.equal(result.mode, "template-only");
    const expectedGo = await queryTemplateLabelTargets("go/lib");
    const expectedNode = await queryTemplateLabelTargets("ts/lib");
    const expected = Array.from(
      new Set([...expectedGo, ...expectedNode, ...TEMPLATE_SAFETY_FLOOR_TARGETS]),
    ).sort();
    assert.deepEqual(result.targets, expected);
  } finally {
    if (ownsTemplateSelectorIsolation) {
      await $({
        stdio: "ignore",
        reject: false,
        env: buckEnv,
      })`buck2 --isolation-dir ${templateSelectorIsolation} kill`;
    }
  }
});
