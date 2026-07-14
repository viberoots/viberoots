import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("nondefault importers use the same marker, cache, probe, and reconcile path", async () => {
  const main = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  assert.match(main, /const importer = normalizeImporter/);
  assert.match(main, /restoreHashFromSharedCache/);
  assert.match(main, /resolveFinalPnpmStore/);
  assert.match(main, /reconcileFixedPnpmStore/);
  assert.doesNotMatch(main, /handleNonDefaultImporter|runUnfixedBuild|prepareFinalPnpmStore/);
});
