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
});
