import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withSharedPnpmStoreReconciliation } from "../../dev/update-pnpm-hash/fixed-store-reconcile";
import {
  readSharedHashCache,
  persistVerifiedHash,
  sharedPnpmStoreHashCacheRoot,
  withSharedHashCacheLock,
  writeSharedHashCache,
} from "../../dev/update-pnpm-hash/verified-marker";

const initialDerivation = `/nix/store/${"a".repeat(32)}-pnpm-store-initial.drv`;
const finalDerivation = `/nix/store/${"b".repeat(32)}-pnpm-store-final.drv`;

function cachePath(root: string, authorityDerivationIdentity: string, lockHash: string): string {
  const authorityKey = crypto
    .createHash("sha256")
    .update(authorityDerivationIdentity)
    .digest("hex");
  return path.join(
    root,
    ".viberoots",
    "workspace",
    "buck",
    "pnpm-store-hash-cache",
    authorityKey,
    `${lockHash}.json`,
  );
}

test("shared fixed-store hash cache remains durable across isolated workspaces", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-native-shared-cache-"));
  const previous = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = root;
  try {
    await writeSharedHashCache(path.join(root, "workspace-a"), {
      lockHash: "lock-a",
      hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
      authorityDerivationIdentity: initialDerivation,
      finalDerivationIdentity: finalDerivation,
    });
    assert.deepEqual(
      await readSharedHashCache({
        repoRoot: path.join(root, "workspace-b"),
        lockHash: "lock-a",
        authorityDerivationIdentity: initialDerivation,
      }),
      {
        lockHash: "lock-a",
        hashValue: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=",
        authorityDerivationIdentity: initialDerivation,
        finalDerivationIdentity: finalDerivation,
      },
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
    assert.equal(
      sharedPnpmStoreHashCacheRoot(process.env, path.join(root, "home")),
      path.join(root, "cache", "viberoots", "pnpm-store-hash-authority"),
    );
    await writeSharedHashCache(path.join(root, "workspace-a"), {
      lockHash: "lock-global",
      hashValue: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=",
      authorityDerivationIdentity: initialDerivation,
      finalDerivationIdentity: finalDerivation,
    });
    assert.deepEqual(
      await readSharedHashCache({
        repoRoot: path.join(root, "workspace-b"),
        lockHash: "lock-global",
        authorityDerivationIdentity: initialDerivation,
      }),
      {
        lockHash: "lock-global",
        hashValue: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=",
        authorityDerivationIdentity: initialDerivation,
        finalDerivationIdentity: finalDerivation,
      },
    );
  } finally {
    if (previousRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = previousRoot;
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("exact derivation authority builds once, serves a follower, and serves the final identity", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-exact-derivation-cache-"));
  const previous = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = root;
  const lockHash = "c".repeat(64);
  const hashValue = "sha256-ccccccccccccccccccccccccccccccccccccccccccc=";
  let builds = 0;
  let realizedIdentity = "";
  try {
    const reconcile = async (
      authorityDerivationIdentity: string,
    ): Promise<"restored" | "reconciled"> =>
      await withSharedPnpmStoreReconciliation({
        force: false,
        withLock: async (fn) =>
          await withSharedHashCacheLock(
            { repoRoot: root, authorityDerivationIdentity, lockHash },
            fn,
          ),
        restore: async () =>
          await readSharedHashCache({ repoRoot: root, authorityDerivationIdentity, lockHash }),
        probe: async () => realizedIdentity,
        acceptRestored: async () => {},
        rejectRestored: async () => {},
        reconcile: async () => {
          builds += 1;
          realizedIdentity = finalDerivation;
          for (const authority of new Set([authorityDerivationIdentity, finalDerivation])) {
            await writeSharedHashCache(root, {
              lockHash,
              hashValue,
              authorityDerivationIdentity: authority,
              finalDerivationIdentity: finalDerivation,
            });
          }
        },
      });

    const [first, follower] = await Promise.all([
      reconcile(initialDerivation),
      reconcile(initialDerivation),
    ]);
    assert.deepEqual([first, follower].sort(), ["reconciled", "restored"]);
    assert.equal(builds, 1);
    assert.equal(await reconcile(finalDerivation), "restored");
    assert.equal(builds, 1);

    realizedIdentity = `/nix/store/${"d".repeat(32)}-conflicting-final.drv`;
    await assert.rejects(reconcile(finalDerivation), /shared pnpm-store identity conflict/);
    assert.equal(builds, 1);
  } finally {
    if (previous === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = previous;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("verified hash persistence restores every marker and cache authority after a partial write", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-hash-persist-rollback-"));
  const previous = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = root;
  const lockHash = "e".repeat(64);
  const markerPath = path.join(root, "workspace", "pnpm-store-verified.root.json");
  const conflictingAuthority = `/nix/store/${"d".repeat(32)}-pnpm-store-conflict.drv`;
  const initialCachePath = cachePath(root, initialDerivation, lockHash);
  const conflictingCachePath = cachePath(root, conflictingAuthority, lockHash);
  const markerBefore = Buffer.from("prior marker bytes\n");
  try {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(markerPath, markerBefore);
    await writeSharedHashCache(root, {
      lockHash,
      hashValue: "sha256-prior=",
      authorityDerivationIdentity: initialDerivation,
      finalDerivationIdentity: initialDerivation,
    });
    const cacheBefore = await fsp.readFile(initialCachePath);
    await fsp.mkdir(path.dirname(path.dirname(conflictingCachePath)), { recursive: true });
    await fsp.writeFile(path.dirname(conflictingCachePath), "fault injection");

    const originalMarker = {
      importer: ".",
      lockfile: "pnpm-lock.yaml",
      lockHash,
      hashValue: "sha256-replacement=",
      builderFingerprint: "builder",
      derivationIdentity: finalDerivation,
    };
    await assert.rejects(
      persistVerifiedHash({
        repoRoot: path.join(root, "workspace"),
        markerPath,
        marker: originalMarker,
        sharedAuthorityDerivationIdentities: [initialDerivation, conflictingAuthority],
        finalDerivationIdentity: finalDerivation,
      }),
      /ENOTDIR|not a directory/,
    );

    assert.deepEqual(await fsp.readFile(markerPath), markerBefore);
    assert.deepEqual(await fsp.readFile(initialCachePath), cacheBefore);
    await assert.rejects(fsp.readFile(conflictingCachePath), /ENOENT|ENOTDIR/);
    await assert.rejects(
      fsp.readFile(cachePath(root, finalDerivation, lockHash)),
      /ENOENT|ENOTDIR/,
    );
  } finally {
    if (previous === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = previous;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
