#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { patchInvalidationStrategyForLang } from "../../lib/lang-contracts";

test("lang-contracts: patch invalidation strategy is explicit for Go/C++ vs Node/Python", () => {
  assert.deepEqual(patchInvalidationStrategyForLang("go"), {
    patchScope: "package-local",
    glueOnApplyRemove: false,
    providerModel: "none",
  });
  assert.deepEqual(patchInvalidationStrategyForLang("cpp"), {
    patchScope: "package-local",
    glueOnApplyRemove: false,
    providerModel: "curated",
  });
  assert.deepEqual(patchInvalidationStrategyForLang("node"), {
    patchScope: "importer-local",
    glueOnApplyRemove: true,
    providerModel: "importer-scoped",
  });
  assert.deepEqual(patchInvalidationStrategyForLang("python"), {
    patchScope: "importer-local",
    glueOnApplyRemove: true,
    providerModel: "importer-scoped",
  });

  assert.equal(patchInvalidationStrategyForLang("rust"), null);
});
