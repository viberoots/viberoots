import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanupChangedOwnedInvalidPnpmStores,
  snapshotOwnedInvalidPnpmStores,
  storePathValidityFromCommand,
  type InvalidStoreCleanupDeps,
} from "../../dev/update-pnpm-hash/invalid-store-cleanup";

const lockHash = "a".repeat(64);
const name = `pnpm-store-lock-${lockHash}`;
const owned = `/nix/store/${"b".repeat(32)}-${name}`;

function deps(overrides: Partial<InvalidStoreCleanupDeps> = {}): InvalidStoreCleanupDeps {
  return {
    listStoreEntries: async () => [owned.slice("/nix/store/".length)],
    isValid: async () => false,
    evidence: async () => ({ sizeKib: 200, mtimeMs: 2 }),
    referrers: async () => [],
    roots: async () => [],
    openOwners: async () => [],
    deletePath: async () => {},
    ...overrides,
  };
}

test("interrupted reconciliation deletes a preexisting owned invalid path only when it grew", async () => {
  const deleted: string[] = [];
  const run = deps({ deletePath: async (storePath) => void deleted.push(storePath) });
  const before = new Map([[owned, { sizeKib: 100, mtimeMs: 1 }]]);
  assert.deepEqual(
    await cleanupChangedOwnedInvalidPnpmStores({ derivationName: name, before, deps: run }),
    [owned],
  );
  assert.deepEqual(deleted, [owned]);
});

test("cleanup refuses unchanged, valid, referenced, rooted, open, and unowned paths", async () => {
  for (const override of [
    { evidence: async () => ({ sizeKib: 100, mtimeMs: 1 }) },
    { isValid: async () => true },
    { referrers: async () => ["referrer"] },
    { roots: async () => ["root"] },
    { openOwners: async () => ["123"] },
    { listStoreEntries: async () => [`${"c".repeat(32)}-other-output`] },
  ]) {
    let deleted = false;
    const before = await snapshotOwnedInvalidPnpmStores({ derivationName: name, deps: deps() });
    await cleanupChangedOwnedInvalidPnpmStores({
      derivationName: name,
      before,
      deps: deps({
        evidence: async () => ({ sizeKib: 201, mtimeMs: 3 }),
        deletePath: async () => void (deleted = true),
        ...override,
      }),
    });
    assert.equal(deleted, false);
  }
});

test("cleanup fails closed when validity or ownership queries fail", async () => {
  await assert.rejects(
    snapshotOwnedInvalidPnpmStores({
      derivationName: name,
      deps: deps({ isValid: async () => await Promise.reject(new Error("daemon unavailable")) }),
    }),
    /daemon unavailable/,
  );

  let deleted = false;
  await assert.rejects(
    cleanupChangedOwnedInvalidPnpmStores({
      derivationName: name,
      before: new Map(),
      deps: deps({
        referrers: async () => await Promise.reject(new Error("query failed")),
        deletePath: async () => void (deleted = true),
      }),
    }),
    /query failed/,
  );
  assert.equal(deleted, false);
});

test("only the exact Nix invalid-path result is treated as invalid", () => {
  assert.equal(
    storePathValidityFromCommand(owned, {
      ok: false,
      errorLines: [`error: path '${owned}' is not valid`],
    }),
    false,
  );
  assert.throws(
    () => storePathValidityFromCommand(owned, { ok: false, errorLines: ["daemon unavailable"] }),
    /could not determine Nix store validity/,
  );
});
