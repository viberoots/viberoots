#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("build consumers do not repair pnpm provisioning state", async () => {
  const nodeModulesBuild = await fsp.readFile(
    "viberoots/build-tools/tools/dev/node-modules-build.ts",
    "utf8",
  );

  assert.doesNotMatch(
    nodeModulesBuild,
    /update-pnpm-hash\.ts|runPnpmHashUpdater|forceRefreshPnpmStoreHash|git add/,
    "node-modules-build.ts must not invoke update-pnpm-hash, force hash refreshes, or stage lock metadata",
  );
  assert.match(
    nodeModulesBuild,
    /run `i` to refresh pnpm hashes and prewarm exact pnpm stores/,
    "node-modules-build.ts must fail clearly with a run `i` diagnostic for missing or stale state",
  );
  assert.match(
    nodeModulesBuild,
    /preparedExactStoreEnv\(lockfileRel\)/,
    "node-modules-build.ts must consume exact stores already warmed by provisioning",
  );
  assert.match(
    nodeModulesBuild,
    /verifiedMarkerPath\(liveMarkerRepoRoot\(\), importer\)/,
    "node-modules-build.ts must read verified markers from live repo state when running from a seed",
  );
  assert.match(
    nodeModulesBuild,
    /nix build .*--impure/,
    "node-modules-build.ts must pass --impure so NIX_PNPM_EXACT_STORE reaches Nix",
  );
});

test("locked Nix pnpm build paths are offline-only", async () => {
  const storeNix = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "utf8",
  );

  assert.match(
    storeNix,
    /pnpm install --offline --force --frozen-lockfile/,
    "locked Nix pnpm install paths must include --offline",
  );
  assert.doesNotMatch(
    storeNix,
    /pnpm install --force --frozen-lockfile/,
    "locked Nix pnpm install paths must not fall through to the live npm registry",
  );
  assert.match(
    storeNix,
    /Run 'i' to refresh pnpm hashes and prewarm exact pnpm stores\./,
    "locked Nix pnpm paths must tell operators to run i when prewarmed state is missing",
  );
});

test("pnpm retry remains scoped to explicit provisioning code", async () => {
  const retrySource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/pnpm-command-retry.ts",
    "utf8",
  );
  const importerLockfile = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
    "utf8",
  );
  const nodeModulesBuild = await fsp.readFile(
    "viberoots/build-tools/tools/dev/node-modules-build.ts",
    "utf8",
  );

  assert.match(retrySource, /runPnpmCommandWithRetry/);
  assert.match(
    importerLockfile,
    /runPnpmCommandWithRetry/,
    "bounded pnpm retry may be used by explicit lockfile provisioning",
  );
  assert.doesNotMatch(
    nodeModulesBuild,
    /runPnpmCommandWithRetry|pnpm-command-retry/,
    "consumer build paths must not use pnpm retry helpers",
  );
});
