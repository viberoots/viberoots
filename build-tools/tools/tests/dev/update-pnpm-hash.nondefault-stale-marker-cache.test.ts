import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("stale builders force a native fixed-output rebuild under the shared cache lock", async () => {
  const main = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  assert.match(main, /withSharedHashCacheLock/);
  assert.match(main, /shouldRebuildFixedStore\(inspectForRebuild\)/);
  assert.match(main, /rebuild: rebuildExisting/);
  assert.match(main, /NIX_PNPM_RECONCILE: "1"/);
  assert.doesNotMatch(main, /stale-builder-recompute|pnpm-store-unfixed/);
});
