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

test("PR-8 scaf preflight refreshes taxonomy artifacts for templates command", async () => {
  await runInTemp("scaf-pr8-template-preflight-templates", async (tmp, _$) => {
    const generatedPath = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "scaf",
      "templates",
      "generated",
      "template-taxonomy.generated.ts",
    );
    await fsp.writeFile(generatedPath, STALE_TAXONOMY_TS, "utf8");

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf templates ts`;
    const stdout = String(out.stdout || "");
    assert.match(stdout, /\bts\tcli\t/);
    assert.doesNotMatch(stdout, /bogus-only/);

    const refreshed = await fsp.readFile(generatedPath, "utf8");
    assert.match(refreshed, /"cli"/);
    assert.doesNotMatch(refreshed, /bogus-only/);
  });
});

test("PR-8 scaf preflight keeps templates --json machine-readable", async () => {
  await runInTemp("scaf-pr8-template-preflight-json", async (tmp, _$) => {
    const generatedPath = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "scaf",
      "templates",
      "generated",
      "template-taxonomy.generated.ts",
    );
    await fsp.writeFile(generatedPath, STALE_TAXONOMY_TS, "utf8");

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf templates ts --json`;
    const parsed = JSON.parse(String(out.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    assert.ok(parsed.some((row) => row.language === "ts" && row.template === "cli"));
  });
});

test("PR-8 scaf preflight refreshes taxonomy artifacts for template completion", async () => {
  await runInTemp("scaf-pr8-template-preflight-complete", async (tmp, _$) => {
    const generatedPath = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "scaf",
      "templates",
      "generated",
      "template-taxonomy.generated.ts",
    );
    await fsp.writeFile(generatedPath, STALE_TAXONOMY_TS, "utf8");

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const out = await $`scaf __complete templates ts`;
    const stdout = String(out.stdout || "");
    assert.match(stdout, /\bcli\b/);
    assert.doesNotMatch(stdout, /bogus-only/);
  });
});
