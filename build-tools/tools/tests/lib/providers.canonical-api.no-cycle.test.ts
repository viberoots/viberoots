#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { viberootsSourcePath } from "./test-helpers/source-paths";

test("providers.ts is the canonical API surface for provider naming helpers", async () => {
  const providers = await import("../../lib/providers");

  assert.equal(typeof providers.normalizeNixAttr, "function");
  assert.equal(typeof providers.providerNameForImporter, "function");
  assert.equal(typeof providers.providerNameForNixAttr, "function");
  assert.equal(typeof providers.encodeForPatchFilename, "function");
  assert.equal(typeof providers.decodeFromPatchFilename, "function");
  assert.equal(typeof providers.decodeNameVersionFromPatch, "function");
});

test("provider-names.ts does not import providers.ts (no providers.ts ↔ provider-names.ts cycle)", async () => {
  const src = await readFile(
    viberootsSourcePath("viberoots/build-tools/tools/lib/provider-names.ts"),
    "utf8",
  );
  assert.ok(!/from\s+["']\.\/providers\.ts["']/.test(src));
});
