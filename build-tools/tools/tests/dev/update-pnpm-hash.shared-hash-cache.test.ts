#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readSharedHashCache,
  writeSharedHashCache,
} from "../../dev/update-pnpm-hash/verified-marker.ts";

test("shared pnpm-store hash cache is keyed by lock hash and builder fingerprint", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-shared-cache-"));
  const prevRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = repoRoot;
  try {
    await writeSharedHashCache(repoRoot, {
      lockHash: "lock-a",
      hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
      builderFingerprint: "builder-1",
    });

    assert.equal(
      await readSharedHashCache({
        repoRoot: path.join(repoRoot, "tmp-workspace"),
        builderFingerprint: "builder-1",
        lockHash: "lock-a",
      }),
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
    );
    assert.equal(
      await readSharedHashCache({
        repoRoot,
        builderFingerprint: "builder-2",
        lockHash: "lock-a",
      }),
      null,
    );
    assert.equal(
      await readSharedHashCache({
        repoRoot,
        builderFingerprint: "builder-1",
        lockHash: "lock-b",
      }),
      null,
    );
  } finally {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
