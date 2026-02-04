#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runImporterProviderSync } from "../../lib/provider-sync-driver";

test("provider-sync-driver requires importerPatchInclusionPolicy", async () => {
  await assert.rejects(
    () =>
      runImporterProviderSync({
        lang: "node",
        discoverLockfiles: async () => [],
        parseEffectiveSetForLockfile: async () => new Map(),
        listImporterPatchesFor: async () => [],
        decodePatchKey: () => null,
      } as any),
    /missing importerPatchInclusionPolicy/,
  );
});
