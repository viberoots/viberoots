#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  CANONICAL_TS_TEMPLATE_IDS,
  assertCanonicalTemplateIdsUnique,
} from "../../scaffolding/scaf/templates/taxonomy.ts";

const EXPECTED_TS_TEMPLATE_IDS = [
  "ts/lib",
  "ts/cli",
  "ts/webapp-static",
  "ts/webapp-static-pwa",
  "ts/webapp-ssr-next",
  "ts/webapp-ssr-vite",
  "ts/cpp-addon",
  "ts/go-addon",
  "ts/wasm-inline",
  "ts/wasm-app",
  "ts/wasm-linking-app",
  "ts/go-cpp-lib",
];

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

test("taxonomy canonical TypeScript id set stays stable", () => {
  assert.deepEqual(sortedUnique(CANONICAL_TS_TEMPLATE_IDS), sortedUnique(EXPECTED_TS_TEMPLATE_IDS));
  assertCanonicalTemplateIdsUnique(CANONICAL_TS_TEMPLATE_IDS);
  const legacyNodeIds = CANONICAL_TS_TEMPLATE_IDS.filter((id) => id.startsWith("node/"));
  assert.equal(legacyNodeIds.length, 0);
});

test("taxonomy matches templates/ts filesystem roots", async () => {
  const tsRoot = path.join("build-tools", "tools", "scaffolding", "templates", "ts");
  const entries = await fsp.readdir(tsRoot, { withFileTypes: true });
  const idsFromFilesystem = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `ts/${entry.name}`);
  assert.deepEqual(sortedUnique(idsFromFilesystem), sortedUnique(CANONICAL_TS_TEMPLATE_IDS));
});

test("filesystem contract: no canonical TypeScript templates remain under templates/node", async () => {
  const nodeRoot = path.join("build-tools", "tools", "scaffolding", "templates", "node");
  const canonicalTsTemplateNames = new Set(
    CANONICAL_TS_TEMPLATE_IDS.map((id) => id.split("/")[1]).filter(Boolean),
  );

  let entries: string[] = [];
  try {
    const dirents = await fsp.readdir(nodeRoot, { withFileTypes: true });
    entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    entries = [];
  }

  const collisions = entries.filter((name) => canonicalTsTemplateNames.has(name));
  assert.deepEqual(collisions, []);
});
