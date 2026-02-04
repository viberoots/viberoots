#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { importerScopedProviderContractForLang } from "../../lib/lang-contracts.ts";

test("lang-contracts: importer-scoped provider contract is explicit for Node vs Python", () => {
  assert.deepEqual(importerScopedProviderContractForLang("node"), {
    importerPatchInclusionPolicy: "all",
    globalPatchDir: { path: "patches/node", selection: "effective-set-only" },
    lockfileLabelAutoAttachRequirement: "requires-kind-stamp",
    providerSyncParsing: { supportsStrict: false, defaultStrict: false },
  });

  assert.deepEqual(importerScopedProviderContractForLang("python"), {
    importerPatchInclusionPolicy: "effective-set-only",
    lockfileLabelAutoAttachRequirement: "requires-kind-stamp",
    providerSyncParsing: { supportsStrict: true, defaultStrict: false },
  });

  assert.equal(importerScopedProviderContractForLang("go"), null);
  assert.equal(importerScopedProviderContractForLang("cpp"), null);
});
