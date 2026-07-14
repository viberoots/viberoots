import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("root and nondefault importers share the fixed-store state machine", async () => {
  const main = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  assert.match(main, /normalizeImporter\(path\.posix\.dirname\(relLock\)\)/);
  assert.match(main, /pnpmStoreAttrFromImporter\(importer\)/);
  assert.match(main, /reconcileFixedPnpmStore\(\{/);
  assert.match(main, /withPnpmStoreBuildFlakeRef\(/);
  assert.doesNotMatch(main, /handleNonDefaultImporter|runUnfixedBuild|pnpm-store-unfixed/);
});
