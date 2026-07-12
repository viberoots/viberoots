#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("exact pnpm store prep stays importer-scoped while updating the local prefetch store", async () => {
  const txt = await fsp.readFile(
    path.resolve(import.meta.dirname, "../../dev/update-pnpm-hash/exact-store.ts"),
    "utf8",
  );
  const fetchTxt = await fsp.readFile(
    path.resolve(import.meta.dirname, "../../dev/update-pnpm-hash/exact-store-fetch.ts"),
    "utf8",
  );
  if (txt.includes("syncLocalPrefetchIntoPnpmStore(storeDir)") || txt.includes("mergePnpmStore(")) {
    throw new Error(
      "prepareExactPnpmStore must not seed importer-specific exact stores from broader pnpm stores",
    );
  }
  if (txt.includes("readUnifiedPnpmStorePath") || txt.includes("unified-pnpm-store")) {
    throw new Error("prepareExactPnpmStore must not read the unified pnpm store");
  }
  if (!txt.includes("syncSourcePnpmStoreIntoLocalPrefetch(storeDir)")) {
    throw new Error("prepareExactPnpmStore must update LOCAL_PNPM_STORE after fetching");
  }
  if (!txt.includes("removeRedundantLocalExactStoreDirs")) {
    throw new Error(
      "prepareExactPnpmStore must clear stale importer-specific stores before refetching",
    );
  }
  if (!txt.includes("storeDir: string") || !txt.includes("homeDir: string")) {
    throw new Error("prepareExactPnpmStore must clear stale exact-store home dirs");
  }
  if (!txt.includes("removeExactStoreArchive(cacheDir)")) {
    throw new Error("prepareExactPnpmStore must remove stale transient exact-store archives");
  }
  if (!txt.includes("await fetchExactPnpmStore({")) {
    throw new Error("prepareExactPnpmStore must run importer exact-store fetch");
  }
  if (!txt.includes("await syncSourcePnpmStoreIntoLocalPrefetch(storeDir)")) {
    throw new Error("prepareExactPnpmStore must sync fetched exact content before cleanup");
  }
  if (!txt.includes("await removeRedundantLocalExactStoreDirs({ storeDir, homeDir })")) {
    throw new Error("prepareExactPnpmStore must remove redundant local exact stores after import");
  }
  if (
    !fetchTxt.includes("delete env.npm_config_store_dir") ||
    !fetchTxt.includes("delete env.NPM_CONFIG_STORE_DIR")
  ) {
    throw new Error(
      "exact-store fetch must ignore shared pnpm store config while fetching into its isolated storeDir",
    );
  }
  for (const fragment of [
    "HOME: opts.homeDir",
    "PNPM_HOME: opts.homeDir",
    "XDG_CONFIG_HOME: xdgConfigHome",
    "XDG_CACHE_HOME: xdgCacheHome",
    "XDG_DATA_HOME: xdgDataHome",
    'CI: "1"',
    'SOURCE_DATE_EPOCH: "1"',
    'TZ: "UTC"',
    'COREPACK_ENABLE: "0"',
    'COREPACK_ENABLE_AUTO_PIN: "0"',
    "delete env.npm_config_cache",
    "delete env.NPM_CONFIG_CACHE",
    "delete env.npm_config_userconfig",
    "delete env.NPM_CONFIG_USERCONFIG",
  ]) {
    if (!fetchTxt.includes(fragment)) {
      throw new Error(
        `exact-store fetch must isolate deterministic pnpm environment; missing ${fragment}`,
      );
    }
  }
});

test("runInTemp dev-env export prewarms exact store before locked materialization", async () => {
  const txt = await fsp.readFile(
    path.resolve(import.meta.dirname, "../lib/test-helpers/run-in-temp.ts"),
    "utf8",
  );
  if (!txt.includes("resolveExactPrefetchedStore({")) {
    throw new Error("runInTemp dev-env export must resolve/prewarm an exact pnpm store first");
  }
  if (
    !txt.includes('importer: "."') ||
    !txt.includes('attrPath: "pnpm-store"') ||
    !txt.includes("NIX_PNPM_EXACT_STORE: exactStore.exactStorePath") ||
    !txt.includes("nix develop --impure")
  ) {
    throw new Error("runInTemp dev-env export must inject the viberoots root exact store");
  }
  if (!txt.includes("await exactStore.cleanup()")) {
    throw new Error("runInTemp dev-env exact-store preparation must keep cleanup scoped");
  }
});

test("locked pnpm-store materialization remains fail-closed without exact prefetch", async () => {
  const txt = await fsp.readFile(
    path.resolve(import.meta.dirname, "../../nix/node-modules/store.nix"),
    "utf8",
  );
  if (!txt.includes("missing exact prefetched store for locked offline build")) {
    throw new Error("mkPnpmStore must keep a clear missing-exact-store error");
  }
  if (!txt.includes("exit 5")) {
    throw new Error("mkPnpmStore must fail when locked/offline exact prefetch is missing");
  }
  if (!txt.includes('elif [ "${if genAllowed then "1" else "0"}" = "1" ]; then')) {
    throw new Error("mkPnpmStore exact-store fetch must stay limited to explicit generation mode");
  }
});
