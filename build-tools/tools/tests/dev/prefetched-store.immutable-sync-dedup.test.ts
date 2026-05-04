#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { syncBuiltPnpmStoreIntoLocalPrefetch } from "../../dev/update-pnpm-hash/prefetched-store";

test("syncBuiltPnpmStoreIntoLocalPrefetch skips re-merging the same immutable store path", async () => {
  const tmp = await fsp.mkdtemp(path.join("/tmp", "prefetched-store-dedup-"));
  const prevLocalStore = process.env.LOCAL_PNPM_STORE;
  try {
    const storeOutPath = path.join(tmp, "store-out");
    const sourceFile = path.join(storeOutPath, "store", "v10", "files", "aa", "blob");
    const localStore = path.join(tmp, "local-store");
    const targetFile = path.join(localStore, "v10", "files", "aa", "blob");

    await fsp.mkdir(path.dirname(sourceFile), { recursive: true });
    await fsp.writeFile(sourceFile, "source-v1\n", "utf8");
    process.env.LOCAL_PNPM_STORE = localStore;

    await syncBuiltPnpmStoreIntoLocalPrefetch(storeOutPath);
    assert.equal(await fsp.readFile(targetFile, "utf8"), "source-v1\n");

    await fsp.writeFile(targetFile, "local-mutated\n", "utf8");
    await syncBuiltPnpmStoreIntoLocalPrefetch(storeOutPath);
    assert.equal(
      await fsp.readFile(targetFile, "utf8"),
      "local-mutated\n",
      "expected second sync of identical immutable store path to be skipped",
    );
  } finally {
    if (typeof prevLocalStore === "string") process.env.LOCAL_PNPM_STORE = prevLocalStore;
    else delete process.env.LOCAL_PNPM_STORE;
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
