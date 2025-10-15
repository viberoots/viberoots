#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import { providerNameForImporter } from "../lib/providers.ts";

test("auto-map includes importer-scoped provider for apps/example", async () => {
  // Ensure glue has been generated prior to this test run.
  const graph = "tools/buck/graph.json";
  if (!(await fs.pathExists(graph))) {
    await $`node tools/buck/export-graph.ts --out ${graph}`;
  }
  await $`node tools/buck/sync-providers-node.ts`;
  await $`node tools/buck/gen-auto-map.ts --graph ${graph} --out third_party/providers/auto_map.bzl`;

  const expected = `//third_party/providers:${providerNameForImporter(
    "apps/example/pnpm-lock.yaml",
    "apps/example",
  )}`;

  const autoMap = await fs.readFile("third_party/providers/auto_map.bzl", "utf8");
  // Look for mapping on either provider_stamp or smoke_test
  assert.ok(
    autoMap.includes("\"//apps/example:provider_stamp\"") ||
      autoMap.includes("\"//apps/example:smoke_test\""),
    "apps/example target keys missing in auto_map.bzl",
  );
  assert.ok(
    autoMap.includes(expected),
    `Expected provider ${expected} not found in auto_map.bzl`,
  );
});


