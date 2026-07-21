#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("build consumers do not repair pnpm provisioning state", async () => {
  const nodeModulesBuild = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/node-modules-build.ts"),
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

test("all Nix command surfaces share the repository pnpm 11 authority", async () => {
  const devshell = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/devshell.nix"),
    "utf8",
  );
  const updateApp = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/outputs-apps.nix"),
    "utf8",
  );
  const remoteWorker = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/packages/remote-worker-tools.nix"),
    "utf8",
  );
  const nodePlanner = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/planner/node-genlike.nix"),
    "utf8",
  );
  const pnpm11 = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/pnpm-11.nix"),
    "utf8",
  );

  assert.match(devshell, /pnpm11 = import \.\/pnpm-11\.nix/);
  assert.match(devshell, /pkgs\.go pnpm11 pkgs\.nodejs_22/);
  assert.doesNotMatch(devshell, /pkgs\.go pkgs\.pnpm/);
  assert.match(updateApp, /pnpm11 = import \.\.\/pnpm-11\.nix/);
  assert.match(updateApp, /program = "\$\{pnpm11\}\/bin\/pnpm"/);
  assert.match(remoteWorker, /pnpm11 = import \.\.\/\.\.\/pnpm-11\.nix/);
  assert.match(remoteWorker, /workerPaths = \[[\s\S]*\bpnpm11\b[\s\S]*\];/);
  assert.doesNotMatch(remoteWorker, /pkgs\.pnpm/);
  assert.match(nodePlanner, /pnpm11 = import \.\.\/pnpm-11\.nix/);
  assert.match(nodePlanner, /nativeBuildInputs =[\s\S]*pkgs\.nodejs_22 pnpm11/);
  assert.doesNotMatch(nodePlanner, /pkgs\.pnpm/);
  assert.match(pnpm11, /#!\$\{pkgs\.nodejs_22\}\/bin\/node/);
});

test("update pnpm test override remains an explicit executable authority", async () => {
  const updatePnpm = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-command/pnpm.ts"),
    "utf8",
  );

  assert.match(updatePnpm, /process\.env\.UPDATE_PNPM_BIN/);
  assert.match(updatePnpm, /const command = override \|\| resolveToolPathSync\("node", env\)/);
  assert.match(updatePnpm, /\.\.\.\(override \? \[\] : \[resolveToolPathSync\("pnpm", env\)\]\)/);
});

test("ordinary pnpm consumers cannot reconcile committed stores", async () => {
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
    const source = await fsp.readFile(viberootsSourcePath(`viberoots/${file}`), "utf8");
    assert.doesNotMatch(source, /prepareFinalPnpmStore|fetchExactPnpmStore|add-fixed/, file);
  }

  const probe = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts"),
    "utf8",
  );
  const evalAuthority = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store-eval.ts"),
    "utf8",
  );
  assert.match(probe, /finalPnpmStoreEvalArgs/);
  assert.match(evalAuthority, /"eval"/);
  assert.match(probe, /"path-info"/);
  assert.match(probe, /probeRealizedFinalPnpmStore\(/);
  assert.doesNotMatch(probe, /prepareFinalPnpmStore|fetchExactPnpmStore|add-fixed/);

  const updater = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const readOnlyBranch =
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
    "";
  assert.match(readOnlyBranch, /final pnpm store is not realized/);
  assert.doesNotMatch(readOnlyBranch, /NIX_PNPM_MATERIALIZE/);
  assert.doesNotMatch(
    readOnlyBranch,
    /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson|reconcileFixedPnpmStore/,
  );
});

test("locked Nix pnpm build paths are offline-only", async () => {
  const storeNix = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/node-modules/store.nix"),
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
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/pnpm-command-retry.ts"),
    "utf8",
  );
  const importerLockfile = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts"),
    "utf8",
  );
  const nodeModulesBuild = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/node-modules-build.ts"),
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
