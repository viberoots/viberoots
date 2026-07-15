import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("fixed pnpm store accepts empty and local-only package maps", async () => {
  const store = await fsp.readFile(
    path.join(root, "build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );

  assert.match(
    store,
    /keys \| map\(select\(test\("\(\^\|@\)\(file\|link\|workspace\):"\) \| not\)\) \| length/,
  );
  assert.match(store, /lockfile has no registry packages; empty fixed store is valid/);
  assert.match(
    store,
    /pnpm fetch produced no content-addressed files for a lockfile with external packages/,
  );
  assert.match(store, /nativeBuildInputs = \[[^\]]*nix[^\]]*pkgs\.yq-go[^\]]*\]/);
  assert.match(store, /actual_hash="\$\(\$\{nix\}\/bin\/nix hash path --sri "\$out"\)"/);
  assert.match(store, /viberoots-pnpm-fod-hash-mismatch-v1 output=\$out/);
  assert.match(store, /rm -rf "\$out"/);
  const preflight = store.indexOf('actual_hash="$(${nix}/bin/nix');
  assert.ok(preflight >= 0);
  assert.ok(store.lastIndexOf("runHook postBuild", preflight) >= 0);
  assert.ok(
    store.indexOf('if [ -e "$out" ]') < store.indexOf('echo "viberoots-pnpm-fod-hash-mismatch-v1'),
  );
});
