#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TEMPLATE_SAFETY_FLOOR_TARGETS,
  resolveTemplateTestSelection,
} from "../../lib/template-test-selector.ts";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

function normalizeTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  if (clean.startsWith("root//")) return clean.slice("root".length);
  return clean;
}

async function queryTemplateLabelTargets(templateId: string): Promise<string[]> {
  const isolationDir = `template_selector_integration_${process.pid}_${Date.now()}`;
  const query = `attrfilter(labels, "template:${templateId}", //...)`;
  const targetPlatform =
    String(process.env.BUCK_TARGET_PLATFORMS || process.env.BUCK_TARGET_PLATFORM || "").trim() ||
    "prelude//platforms:default";
  try {
    const out = await $({
      stdio: "pipe",
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms ${targetPlatform} ${query} --json --output-attribute name`;
    const raw = JSON.parse(String(out.stdout || "{}")) as Record<string, { name?: string }>;
    return Array.from(new Set(Object.keys(raw).map((k) => normalizeTarget(k)))).sort();
  } finally {
    await $({
      stdio: "ignore",
      reject: false,
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} kill`;
  }
}

test("selector output matches Buck template label query results", async () => {
  const changedPaths = [
    "build-tools/tools/scaffolding/templates/go/lib/copier.yaml",
    "build-tools/tools/scaffolding/templates/node/lib/copier.yaml",
  ];
  const result = await resolveTemplateTestSelection({
    root: process.cwd(),
    changedPaths,
  });

  assert.equal(result.mode, "template-only");
  const expectedGo = await queryTemplateLabelTargets("go/lib");
  const expectedNode = await queryTemplateLabelTargets("node/lib");
  const expected = Array.from(
    new Set([...expectedGo, ...expectedNode, ...TEMPLATE_SAFETY_FLOOR_TARGETS]),
  ).sort();
  assert.deepEqual(result.targets, expected);
});
