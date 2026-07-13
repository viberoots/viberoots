import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";

test("nondefault reconciliation recreates filtered input after a hash update", async () => {
  const main = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const state = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts",
    "utf8",
  );
  assert.match(
    main,
    /const runBuild = async \(rebuild: boolean\) =>\s*await withPnpmStoreBuildFlakeRef/,
  );
  assert.match(
    state,
    /try \{\s*await opts\.updateHash\(suggested\);\s*second = await opts\.runBuild\(false\);\s*\} catch \(error\) \{\s*await restoreMetadataOrThrow\(opts\.restoreMetadata, error\)/,
  );
  assert.doesNotMatch(main + state, /unfixed|add-fixed/);
});
