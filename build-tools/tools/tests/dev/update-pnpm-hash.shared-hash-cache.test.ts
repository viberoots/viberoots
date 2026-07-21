import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readSharedHashCache,
  writeSharedHashCache,
} from "../../dev/update-pnpm-hash/verified-marker";

test("shared fixed-store hash cache remains durable across isolated workspaces", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-native-shared-cache-"));
  const previous = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = root;
  try {
    await writeSharedHashCache(path.join(root, "workspace-a"), {
      lockHash: "lock-a",
      hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
      builderFingerprint: "builder-a",
    });
    assert.equal(
      await readSharedHashCache({
        repoRoot: path.join(root, "workspace-b"),
        lockHash: "lock-a",
        builderFingerprint: "builder-a",
      }),
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
    );
  } finally {
    if (previous === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = previous;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("fixed-store hash authority is user-global without a workspace override", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-global-hash-authority-"));
  const previousRoot = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  const previousCache = process.env.XDG_CACHE_HOME;
  delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.XDG_CACHE_HOME = path.join(root, "cache");
  try {
    await writeSharedHashCache(path.join(root, "workspace-a"), {
      lockHash: "lock-global",
      hashValue: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=",
      builderFingerprint: "builder-global",
    });
    assert.equal(
      await readSharedHashCache({
        repoRoot: path.join(root, "workspace-b"),
        lockHash: "lock-global",
        builderFingerprint: "builder-global",
      }),
      "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=",
    );
  } finally {
    if (previousRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = previousRoot;
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
