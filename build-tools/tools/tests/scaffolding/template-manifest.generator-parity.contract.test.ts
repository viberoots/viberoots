#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATED_ADAPTER_BZL_PATH,
  GENERATED_TAXONOMY_TS_PATH,
  readGeneratedFile,
  readTemplateManifest,
  renderGeneratedTaxonomyTs,
  renderTemplateTaxonomyAdapterBzl,
} from "../../scaffolding/template-manifest";

test("parity: generated taxonomy adapter is fresh from canonical manifest", async () => {
  const manifest = await readTemplateManifest();
  const expected = renderTemplateTaxonomyAdapterBzl(manifest);
  const current = await readGeneratedFile(GENERATED_ADAPTER_BZL_PATH);
  assert.equal(
    current,
    expected,
    "template taxonomy adapter is stale; run node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts",
  );
});

test("parity: generated runtime taxonomy data is fresh from canonical manifest", async () => {
  const manifest = await readTemplateManifest();
  const expected = renderGeneratedTaxonomyTs(manifest);
  const current = await readGeneratedFile(GENERATED_TAXONOMY_TS_PATH);
  assert.equal(
    current,
    expected,
    "runtime taxonomy data is stale; run node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts",
  );
});
