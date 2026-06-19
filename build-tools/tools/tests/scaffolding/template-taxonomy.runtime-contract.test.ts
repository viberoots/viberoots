#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readTemplateMeta } from "../../scaffolding/scaf/templates/meta";
import { canonicalTemplateIdsForLanguage } from "../../scaffolding/scaf/templates/taxonomy";
import { runInTemp } from "../lib/test-helpers";

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

test("runtime contract: scaf templates ts is taxonomy-authoritative", async () => {
  await runInTemp("template-taxonomy-runtime", async (_tmp, _$) => {
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

test("negative path: missing canonical template root fails deterministically", async () => {
  await runInTemp("template-taxonomy-missing-root", async (tmp) => {
    const missingId = "ts/lib";
    const missingRoot = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "lib",
    );
    await fsp.rm(missingRoot, { recursive: true, force: true });

    const prevCwd = process.cwd();
    const prevSourceRoot = process.env.VIBEROOTS_SOURCE_ROOT;
    const prevRoot = process.env.VIBEROOTS_ROOT;
    try {
      process.chdir(tmp);
      process.env.VIBEROOTS_SOURCE_ROOT = path.join(tmp, "viberoots");
      process.env.VIBEROOTS_ROOT = path.join(tmp, "viberoots");
      await assert.rejects(
        async () => await readTemplateMeta("ts"),
        new RegExp(`missing template root for canonical id '${missingId}'`),
        "error output must include deterministic missing-root contract text",
      );
    } finally {
      process.chdir(prevCwd);
      if (prevSourceRoot === undefined) {
        delete process.env.VIBEROOTS_SOURCE_ROOT;
      } else {
        process.env.VIBEROOTS_SOURCE_ROOT = prevSourceRoot;
      }
      if (prevRoot === undefined) {
        delete process.env.VIBEROOTS_ROOT;
      } else {
        process.env.VIBEROOTS_ROOT = prevRoot;
      }
    }
  });
});
