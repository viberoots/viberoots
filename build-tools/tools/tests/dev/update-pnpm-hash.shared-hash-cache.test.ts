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
