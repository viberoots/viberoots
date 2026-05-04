#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import {
  CANONICAL_TEMPLATE_IDS,
  CANONICAL_TS_TEMPLATE_IDS,
  assertCanonicalTemplateIdsUnique,
  canonicalTemplateIdsForLanguage,
  hasCanonicalTemplateId,
} from "../../scaffolding/scaf/templates/taxonomy";
import { readTemplateMeta } from "../../scaffolding/scaf/templates/meta";
import { TEMPLATE_SAFETY_FLOOR_TARGETS } from "../../lib/template-test-selector";

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function templateIdFromRootPath(rootPath: string): string | null {
  const normalized = String(rootPath || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const prefix = "build-tools/tools/scaffolding/templates/";
  if (!normalized.startsWith(prefix)) return null;
  const rel = normalized.slice(prefix.length);
  const parts = rel.split("/");
  if (parts.length !== 2) return null;
  const language = String(parts[0] || "").trim();
  const template = String(parts[1] || "").trim();
  if (!language || !template) return null;
  return `${language}/${template}`;
}

function parseTemplateConventionIdsFromBzl(src: string): string[] {
  const out: string[] = [];
  const listPattern = /"template_roots":\s*\[([^\]]*)\]/g;
  for (const match of src.matchAll(listPattern)) {
    const body = String(match[1] || "");
    for (const rootMatch of body.matchAll(/"([^"]+)"/g)) {
      const id = templateIdFromRootPath(String(rootMatch[1] || ""));
      if (id) out.push(id);
    }
  }
  return sortedUnique(out);
}

function parseCanonicalTemplateIdsFromAdapter(src: string): string[] {
  const block = src.match(/CANONICAL_TEMPLATE_IDS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  const out: string[] = [];
  for (const m of String(block[1] || "").matchAll(/"([^"]+)"/g)) {
    const id = String(m[1] || "").trim();
    if (id) out.push(id);
  }
  return sortedUnique(out);
}

function parseConventionScriptKeysFromBzl(src: string): string[] {
  const out: string[] = [];
  const block = src.match(/_TEMPLATE_TEST_CONVENTIONS\s*=\s*\{([\s\S]*?)\n\}/);
  if (!block) return out;
  const body = String(block[1] || "");
  for (const m of body.matchAll(/^\s*"([^"]+)":\s*\{/gm)) {
    const script = String(m[1] || "").trim();
    if (script) out.push(script);
  }
  return sortedUnique(out);
}

function parseSafetyFloorScriptsFromBzl(src: string): string[] {
  const out: string[] = [];
  const block = src.match(/TEMPLATE_SAFETY_FLOOR_SCRIPTS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return out;
  const body = String(block[1] || "");
  for (const m of body.matchAll(/"([^"]+)"/g)) {
    const script = String(m[1] || "").trim();
    if (script) out.push(script);
  }
  return sortedUnique(out);
}

function targetNameFromScript(script: string): string {
  let n = script;
  const prefix = "build-tools/tools/tests/";
  if (n.startsWith(prefix)) n = n.slice(prefix.length);
  if (n.endsWith(".ts")) n = n.slice(0, -3);
  if (n.endsWith(".test")) n = n.slice(0, -5);
  return n.replace(/[/.-]/g, "_");
}

test("taxonomy contract: canonical ids are unique and language-qualified", () => {
  assertCanonicalTemplateIdsUnique(CANONICAL_TEMPLATE_IDS);
  for (const id of CANONICAL_TEMPLATE_IDS) {
    assert.match(id, /^[^/]+\/[^/]+$/, `invalid canonical template id: ${id}`);
  }
});

test("parity: resolver and metadata readers match canonical ts ids", async () => {
  const resolverRaw = await fsp.readFile("build-tools/tools/scaffolding/resolver.json", "utf8");
  const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
  const resolverTsIds = Object.keys(resolver.ts || {}).map((template) => `ts/${template}`);
  assert.deepEqual(sortedUnique(resolverTsIds), sortedUnique(CANONICAL_TS_TEMPLATE_IDS));

  const metaRows = await readTemplateMeta("ts");
  const metaIds = metaRows.map((row) => `ts/${row.template}`);
  assert.deepEqual(sortedUnique(metaIds), sortedUnique(CANONICAL_TS_TEMPLATE_IDS));
  assert.deepEqual(
    sortedUnique(canonicalTemplateIdsForLanguage("ts")),
    sortedUnique(CANONICAL_TS_TEMPLATE_IDS),
  );
});

test("anti-drift: template conventions reference canonical taxonomy only", async () => {
  const bzl = await fsp.readFile("build-tools/tools/tests/template_conventions.bzl", "utf8");
  assert.equal(
    bzl.includes("template_keys"),
    false,
    "template conventions must not use manual template_keys registration; use template_roots path conventions",
  );
  const conventionIds = parseTemplateConventionIdsFromBzl(bzl);
  for (const id of conventionIds) {
    assert.equal(hasCanonicalTemplateId(id), true, `template convention has unknown id: ${id}`);
  }

  const scripts = parseConventionScriptKeysFromBzl(bzl);
  const safetyFloorScripts = parseSafetyFloorScriptsFromBzl(bzl);
  for (const script of safetyFloorScripts) {
    assert.equal(
      scripts.includes(script),
      true,
      `safety-floor script missing convention: ${script}`,
    );
  }
  const safetyFloorTargetsFromBzl = safetyFloorScripts.map(
    (script) => `//:${targetNameFromScript(script)}`,
  );
  assert.deepEqual(
    sortedUnique(safetyFloorTargetsFromBzl),
    sortedUnique([...TEMPLATE_SAFETY_FLOOR_TARGETS]),
  );
});

test("parity: template taxonomy adapter ids match canonical taxonomy", async () => {
  const adapter = await fsp.readFile(
    "build-tools/tools/tests/template_taxonomy_adapter.bzl",
    "utf8",
  );
  const adapterIds = parseCanonicalTemplateIdsFromAdapter(adapter);
  assert.deepEqual(adapterIds, sortedUnique(CANONICAL_TEMPLATE_IDS));
});
