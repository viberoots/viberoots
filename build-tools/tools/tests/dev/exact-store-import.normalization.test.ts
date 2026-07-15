import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("Nix-native pnpm store normalization is deterministic and excludes project links", async () => {
  const store = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  assert.match(store, /normalize_pnpm_store_for_fod/);
  assert.match(store, /SELECT hex\(CAST\(key AS BLOB\)\)[\s\S]*ORDER BY key/);
  assert.match(
    store,
    /delete obj\.checkedAt; delete obj\.createdAt; delete obj\.updatedAt; delete obj\.timestamp/,
  );
  assert.match(store, /rm -rf "\$out\/store"\/v\*\/projects/);
  assert.match(store, /find "\$out\/store" -exec touch -h -t 197001010000/);
  assert.match(store, /fs\.writeSync\(fd, Buffer\.alloc\(4\), 0, 4, 96\)/);
  assert.doesNotMatch(store, /exact-store-import|add-fixed/);
});
