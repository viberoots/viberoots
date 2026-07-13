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
  assert.doesNotMatch(nodeModulesBuild, /prepareFinalPnpmStore|fetchExactPnpmStore|add-fixed/);
  assert.match(
    nodeModulesBuild,
    /verifiedMarkerPath\(liveMarkerRepoRoot\(\), importer\)/,
    "node-modules-build.ts must read verified markers from live repo state when running from a seed",
  );
  assert.match(
    nodeModulesBuild,
    /recoverOutPathFromLinkMarker\(importer, lockfileRel\)/,
    "node-modules-build.ts must reuse already-provisioned node_modules outputs before Nix builds",
  );
  assert.doesNotMatch(nodeModulesBuild, /NIX_PNPM_EXACT_STORE/);
});

test("ordinary pnpm consumers only probe realized committed stores", async () => {
  const ordinaryFiles = [
    "build-tools/tools/dev/node-modules-build.ts",
    "build-tools/tools/dev/require-unified-pnpm-store.ts",
    "build-tools/tools/dev/dev-build/materialize-pure.ts",
    "build-tools/tools/dev/build-selected.ts",
    "build-tools/tools/dev/run-runnable-graph.ts",
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
    "build-tools/tools/dev/install/link-node.ts",
  ];
  for (const file of ordinaryFiles) {
    const source = await fsp.readFile(`viberoots/${file}`, "utf8");
    assert.doesNotMatch(source, /prepareFinalPnpmStore|fetchExactPnpmStore|add-fixed/, file);
  }

  const probe = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts",
    "utf8",
  );
  assert.match(probe, /"eval"/);
  assert.match(probe, /"path-info"/);
  assert.match(probe, /probeRealizedFinalPnpmStore\(/);
  assert.doesNotMatch(probe, /prepareFinalPnpmStore|fetchExactPnpmStore|add-fixed/);
});

test("locked Nix pnpm build paths are offline-only", async () => {
  const storeNix = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "utf8",
  );

  assert.match(storeNix, /final fixed pnpm store is missing/);
  const lockedBuildStoreNix = storeNix.replace(
    /bootstrapExactStoreFetchScript = label: ''[\s\S]*?^  '';/m,
    "",
  );
  const pnpmInstallCommands = lockedBuildStoreNix
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\$PNPM_BIN"? install\b/.test(line))
    .filter((line) => !line.includes("install --help"));
  assert.deepEqual(
    pnpmInstallCommands,
    [],
    "locked Nix pnpm paths must not run pnpm install; exact stores must already be provisioned",
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
