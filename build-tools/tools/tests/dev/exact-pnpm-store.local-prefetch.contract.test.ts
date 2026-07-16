import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("pnpm reconciliation is Nix-native and unavailable to ordinary consumers", async () => {
  const store = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  const updater = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const reconciliation = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts"),
    "utf8",
  );
  const stage0 = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/lib/consumer-direnv.ts"),
    "utf8",
  );
  assert.match(store, /NIX_PNPM_RECONCILE/);
  assert.match(store, /"\$PNPM_BIN" fetch/);
  assert.match(reconciliation, /NIX_PNPM_RECONCILE: "1"/);
  assert.doesNotMatch(stage0, /NIX_PNPM_RECONCILE|add-fixed/);
  assert.doesNotMatch(
    store + updater + reconciliation,
    /add-fixed|mkPnpmStoreUnfixed|pnpm-store-unfixed/,
  );
});
