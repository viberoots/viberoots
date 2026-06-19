#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATED_RESOLVER_JSON_PATH,
  readGeneratedFile,
  readTemplateManifest,
  renderResolverJson,
} from "../../scaffolding/template-manifest";

test("parity: resolver mappings are generated from canonical manifest", async () => {
  const manifest = await readTemplateManifest();
  const expected = renderResolverJson(manifest);
  const current = await readGeneratedFile(GENERATED_RESOLVER_JSON_PATH);
  assert.equal(
    current,
    expected,
    "resolver.json is stale; run node viberoots/build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts",
  );
});
