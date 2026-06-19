#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("exact pnpm store prep stays importer-scoped while updating the local prefetch store", async () => {
  const txt = await fsp.readFile(
    path.resolve(import.meta.dirname, "../../dev/update-pnpm-hash/exact-store.ts"),
    "utf8",
  );
  if (txt.includes("syncLocalPrefetchIntoPnpmStore(storeDir)")) {
    throw new Error(
      "prepareExactPnpmStore must not seed importer-specific exact stores from LOCAL_PNPM_STORE",
    );
  }
  if (!txt.includes("syncSourcePnpmStoreIntoLocalPrefetch(storeDir)")) {
    throw new Error("prepareExactPnpmStore must update LOCAL_PNPM_STORE after fetching");
  }
  if (!txt.includes("await fsp.rm(storeDir, { recursive: true, force: true })")) {
    throw new Error(
      "prepareExactPnpmStore must clear stale importer-specific stores before refetching",
    );
  }
  if (!txt.includes("removeExactStoreArchive(cacheDir)")) {
    throw new Error("prepareExactPnpmStore must remove stale transient exact-store archives");
  }
});
