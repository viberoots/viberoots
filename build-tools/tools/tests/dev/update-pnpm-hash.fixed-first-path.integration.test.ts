import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("root and nondefault importers share the fixed-store state machine", async () => {
  const main = (
    await Promise.all(
      ["update-pnpm-hash.ts", "update-pnpm-hash/fixed-store-reconcile.ts"].map((rel) =>
        fsp.readFile(viberootsSourcePath(`build-tools/tools/dev/${rel}`), "utf8"),
      ),
    )
  ).join("\n");
  assert.match(main, /normalizeImporter\(path\.posix\.dirname\(relLock\)\)/);
  assert.match(main, /pnpmStoreAttrFromImporter\(importer\)/);
  assert.match(main, /reconcileFixedPnpmStore\(\{/);
  assert.match(main, /withPnpmStoreBuildFlakeRef\(/);
  assert.doesNotMatch(main, /handleNonDefaultImporter|runUnfixedBuild|pnpm-store-unfixed/);
});
