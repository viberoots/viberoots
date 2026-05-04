#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { mergePnpmStore } from "../../dev/update-pnpm-hash/prefetched-store";

test("mergePnpmStore respects the shared sync lock for the target store", async () => {
  const tmp = await fsp.mkdtemp(path.join("/tmp", "prefetched-store-merge-lock-"));
  const sourceStore = path.join(tmp, "source-store");
  const targetStore = path.join(tmp, "target-store");
  const srcFile = path.join(sourceStore, "v10", "files", "aa", "blob");
  const dstFile = path.join(targetStore, "v10", "files", "aa", "blob");
  const lockPath = path.join(tmp, ".sync.lock");

  try {
    await fsp.mkdir(path.dirname(srcFile), { recursive: true });
    await fsp.writeFile(srcFile, "blob\n", "utf8");
    await fsp.mkdir(targetStore, { recursive: true });
    await fsp.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAtMs: Date.now() }),
      "utf8",
    );

    const releaseDelayMs = 300;
    const start = Date.now();
    const release = setTimeout(() => {
      void fsp.rm(lockPath, { force: true });
    }, releaseDelayMs);

    try {
      await mergePnpmStore(sourceStore, targetStore);
    } finally {
      clearTimeout(release);
      await fsp.rm(lockPath, { force: true }).catch(() => {});
    }

    const elapsedMs = Date.now() - start;
    assert.ok(
      elapsedMs >= releaseDelayMs - 50,
      `expected merge to wait for sync lock; elapsed=${elapsedMs}ms`,
    );
    assert.equal(await fsp.readFile(dstFile, "utf8"), "blob\n");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
