#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { CANONICAL_TS_TEMPLATE_IDS } from "../../scaffolding/scaf/templates/taxonomy.ts";

test("webapp-ssr-express is no longer scaffoldable", async () => {
  await runInTemp("webapp-ssr-express-removal-contract", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const res = await $`scaf new ts webapp-ssr-express demo-removed --yes --no-tests`
      .quiet()
      .nothrow();
    assert.notEqual(
      res.exitCode,
      0,
      `expected scaf to fail for removed template, got exit ${res.exitCode}`,
    );
    const err = String(res.stderr || res.stdout || "");
    assert.ok(
      err.includes("webapp-ssr-express") || err.includes("unknown") || err.includes("not found"),
      `expected error about unknown/removed template, got: ${err.slice(0, 300)}`,
    );
  });
});

test("template conventions and manifests exclude webapp-ssr-express", async () => {
  assert.ok(
    !CANONICAL_TS_TEMPLATE_IDS.includes("ts/webapp-ssr-express"),
    "canonical taxonomy must not include ts/webapp-ssr-express",
  );

  const tsRoot = path.join("build-tools", "tools", "scaffolding", "templates", "ts");
  const entries = await fsp.readdir(tsRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(
    !dirs.includes("webapp-ssr-express"),
    `templates/ts must not contain webapp-ssr-express dir, got: ${dirs.join(", ")}`,
  );
});
