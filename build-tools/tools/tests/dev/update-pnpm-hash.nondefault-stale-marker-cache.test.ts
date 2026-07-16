import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("stale builders force a native fixed-output rebuild under the shared cache lock", async () => {
  const reconciliation = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts"),
    "utf8",
  );
  assert.match(reconciliation, /withSharedHashCacheLock/);
  assert.match(reconciliation, /shouldRebuildFixedStore\(opts\.inspectForRebuild\)/);
  assert.match(reconciliation, /rebuild: rebuildExisting/);
  assert.match(reconciliation, /NIX_PNPM_RECONCILE: "1"/);
  assert.doesNotMatch(reconciliation, /stale-builder-recompute|pnpm-store-unfixed/);
});
