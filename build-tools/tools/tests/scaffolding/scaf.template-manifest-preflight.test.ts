#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const STALE_TAXONOMY_TS = [
  "// GENERATED FILE — DO NOT EDIT.",
  "// stale test payload",
  "",
  "export const TEMPLATE_NAME_ALIASES: Record<string, string> = {};",
  "",
  'export const TEMPLATE_TAXONOMY = { "ts": ["bogus-only"] } as const;',
  "",
].join("\n");

function generatedTaxonomyPath(tmp: string): string {
  return path.join(
    tmp,
    "viberoots",
    "build-tools",
    "tools",
    "scaffolding",
    "scaf",
    "templates",
    "generated",
    "template-taxonomy.generated.ts",
  );
}

async function writeStaleTaxonomy(tmp: string): Promise<string> {
  const generatedPath = generatedTaxonomyPath(tmp);
  await fsp.mkdir(path.dirname(generatedPath), { recursive: true });
  await fsp.writeFile(generatedPath, STALE_TAXONOMY_TS, "utf8");
  return generatedPath;
}

test("scaf templates command ignores stale taxonomy artifacts", async () => {
  await runInTemp("scaf-template-preflight-templates", async (tmp, _$) => {
    const generatedPath = await writeStaleTaxonomy(tmp);

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf templates ts`;
    const stdout = String(out.stdout || "");
    assert.match(stdout, /^ts:$/m);
    assert.match(stdout, /^  cli\s+Node CLI/m);
    assert.doesNotMatch(stdout, /bogus-only/);

    const refreshed = await fsp.readFile(generatedPath, "utf8");
    assert.match(refreshed, /\bcli\b/);
    assert.doesNotMatch(refreshed, /bogus-only/);
  });
});

test("scaf preflight keeps templates --json machine-readable", async () => {
  await runInTemp("scaf-template-preflight-json", async (tmp, _$) => {
    await writeStaleTaxonomy(tmp);

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf templates ts --json`;
    const parsed = JSON.parse(String(out.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    assert.ok(parsed.some((row) => row.language === "ts" && row.template === "cli"));
  });
});

test("scaf preflight refreshes taxonomy artifacts for template completion", async () => {
  await runInTemp("scaf-template-preflight-complete", async (tmp, _$) => {
    await writeStaleTaxonomy(tmp);

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf __complete templates ts`;
    const stdout = String(out.stdout || "");
    assert.match(stdout, /\bcli\b/);
    assert.doesNotMatch(stdout, /bogus-only/);
  });
});
