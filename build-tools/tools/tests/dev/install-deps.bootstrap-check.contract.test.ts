#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps runs bootstrap completion check before install setup and honors dry-run", async () => {
  const source = await fsp.readFile("viberoots/build-tools/tools/dev/install/deps-main.ts", "utf8");
  const checkIndex = source.indexOf("await checkBootstrapCompletion({");
  const cachePolicyIndex = source.indexOf("await applyNixCacheHealthPolicy(repoRoot)");
  const importersIndex = source.indexOf("await discoverImportersWithLock");

  assert.ok(checkIndex >= 0, "deps-main.ts must call checkBootstrapCompletion");
  assert.ok(
    cachePolicyIndex > checkIndex,
    "bootstrap completion repair must run before cache policy/install setup",
  );
  assert.ok(
    importersIndex > checkIndex,
    "bootstrap completion repair must run before importer discovery",
  );
  assert.match(
    source.slice(checkIndex, cachePolicyIndex),
    /repair:\s*!dryRun/,
    "install-deps dry-run must not repair incomplete bootstrap state",
  );
});
