import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const mixedProducer =
  "build-tools/tools/tests/node/node.wasm-stage-inline.mixed-producer-labels.test.ts";
const goAddonRuntime = "build-tools/tools/tests/scaffolding/node-go-addon.runtime.e2e.test.ts";

test("nested Node WASM artifact builds use safe execution lanes", async () => {
  const resourceTaxonomy = await fsp.readFile(
    path.join(root, "build-tools/tools/tests/resource_limited_taxonomy.bzl"),
    "utf8",
  );
  const isolatedTaxonomy = await fsp.readFile(
    path.join(root, "build-tools/tools/tests/isolated_test_conventions.bzl"),
    "utf8",
  );

  for (const rel of [
    "build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts",
    "build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts",
  ]) {
    assert.ok(resourceTaxonomy.includes(`${JSON.stringify(rel)}: True`), rel);
  }
  assert.ok(isolatedTaxonomy.includes(`${JSON.stringify(mixedProducer)}: True`), mixedProducer);
  assert.ok(
    !resourceTaxonomy.includes(`${JSON.stringify(mixedProducer)}: True`),
    `${mixedProducer} must not also run in the concurrent resource-limited lane`,
  );
  assert.ok(isolatedTaxonomy.includes(`${JSON.stringify(goAddonRuntime)}: True`), goAddonRuntime);
  assert.ok(
    !resourceTaxonomy.includes(`${JSON.stringify(goAddonRuntime)}: True`),
    `${goAddonRuntime} starts a nested Buck daemon and must not run in the concurrent resource-limited lane`,
  );
});
