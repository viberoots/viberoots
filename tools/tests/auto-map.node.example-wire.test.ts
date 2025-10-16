#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../lib/providers.ts";

test("auto-map includes importer-scoped provider for apps/example", async () => {
  // Ensure glue has been generated prior to this test run.
  const graph = "tools/buck/graph.json";
  const NODE = "node";
  const ZX = path.resolve("tools/dev/zx-init.mjs");
  const nodeFlags = [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    ZX,
  ];
  if (!(await fs.pathExists(graph))) {
    await $`${NODE} ${nodeFlags} tools/buck/export-graph.ts --out ${graph}`;
  }
  await $`${NODE} ${nodeFlags} tools/buck/sync-providers-node.ts`;
  await $`${NODE} ${nodeFlags} tools/buck/gen-auto-map.ts --graph ${graph} --out third_party/providers/auto_map.bzl`;

  const expected = `//third_party/providers:${providerNameForImporter(
    "apps/example/pnpm-lock.yaml",
    "apps/example",
  )}`;

  const autoMap = await fs.readFile("third_party/providers/auto_map.bzl", "utf8");
  // Look for mapping on either provider_stamp or smoke_test; allow config suffixes
  const hasProviderStamp =
    /".*apps\/example:provider_stamp(?: \(config\/\/platforms:[^)]*\))?"/m.test(autoMap);
  const hasSmokeTest = /".*apps\/example:smoke_test(?: \(config\/\/platforms:[^)]*\))?"/m.test(
    autoMap,
  );
  assert.ok(hasProviderStamp || hasSmokeTest, "apps/example target keys missing in auto_map.bzl");
  assert.ok(autoMap.includes(expected), `Expected provider ${expected} not found in auto_map.bzl`);
});
