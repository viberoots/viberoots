#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { canonicalTemplateIdsForLanguage } from "../../scaffolding/scaf/templates/taxonomy.ts";
import { runInTemp } from "../lib/test-helpers";

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

test("PR-5 runtime contract: scaf templates ts is taxonomy-authoritative", async () => {
  await runInTemp("template-taxonomy-pr5-runtime", async (_tmp, _$) => {
    const out = await _$({ stdio: "pipe" })`scaf templates ts --json`;
    const rows = JSON.parse(String(out.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const listedIds = rows
      .filter((row) => row.language === "ts")
      .map((row) => `ts/${row.template}`);
    assert.deepEqual(
      sortedUnique(listedIds),
      sortedUnique(canonicalTemplateIdsForLanguage("ts")),
      "scaf templates ts must match canonical taxonomy ids",
    );
  });
});

test("PR-5 negative path: missing canonical template root fails deterministically", async () => {
  await runInTemp("template-taxonomy-pr5-missing-root", async (tmp, _$) => {
    const missingId = "ts/lib";
    const missingRoot = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "lib",
    );
    await fsp.rm(missingRoot, { recursive: true, force: true });

    const out = await _$({ stdio: "pipe" })`scaf templates ts --json`.nothrow();
    assert.notEqual((out as any).exitCode, 0);
    const text = `${String((out as any).stdout || "")}\n${String((out as any).stderr || "")}`;
    assert.match(
      text,
      new RegExp(`missing template root for canonical id '${missingId}'`),
      "error output must include deterministic missing-root contract text",
    );
  });
});
