import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";

test("fixed pnpm store reconciliation keeps outputHash and verifies updated metadata", async () => {
  const store = await fsp.readFile("build-tools/tools/nix/node-modules/store.nix", "utf8");
  const updater = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const state = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts",
    "utf8",
  );
  assert.match(store, /outputHashMode = "recursive"/);
  assert.match(store, /outputHash = outHash/);
  assert.match(updater, /snapshotNodeModulesHashesJson/);
  assert.match(state, /await opts\.updateHash\(suggested\)[\s\S]*await opts\.runBuild\(false\)/);
  assert.match(state, /restoreMetadataOrThrow/);
  assert.match(state, /new AggregateError/);
  assert.doesNotMatch(store + updater + state, /add-fixed|unfixed-build|mkPnpmStoreUnfixed/);
});
