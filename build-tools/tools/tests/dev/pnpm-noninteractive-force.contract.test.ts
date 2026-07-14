import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("native pnpm reconciliation is noninteractive, pinned, and bounded", async () => {
  const store = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  const nix = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/nix.ts"),
    "utf8",
  );
  for (const fragment of [
    'PNPM_BIN="${pnpm}/bin/pnpm"',
    'CI="1"',
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--network-concurrency 1",
    "--child-concurrency 1",
    "--package-import-method hardlink",
    "--trust-lockfile",
  ]) {
    assert.ok(store.includes(fragment), fragment);
  }
  assert.match(nix, /"keep-failed",\s*"false"/);
  assert.doesNotMatch(store, /pnpm-store-unfixed|add-fixed/);
});
