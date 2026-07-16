import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanupChangedOwnedInvalidPnpmStores,
  INVALID_STORE_CLEANUP_TIMEOUT_MS,
  INVALID_STORE_QUERY_TIMEOUT_MS,
  INVALID_STORE_SHUTDOWN_MARGIN_MS,
  invalidStoreChildTimeoutMs,
  runInvalidStoreCleanupCommand,
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
  const logs: string[] = [];
  const run = deps({ deletePath: async (storePath) => void deleted.push(storePath) });
  const before = new Map([[owned, { sizeKib: 100, mtimeMs: 1 }]]);
  assert.deepEqual(
    await cleanupChangedOwnedInvalidPnpmStores({
      derivationName: name,
      before,
      deps: run,
      log: (message) => logs.push(message),
    }),
    [owned],
  );
  assert.deepEqual(deleted, [owned]);
  assert.match(logs[0] || "", /size_kib=200 .*referrers=0 roots=0 open_owners=0/);
});

test("invalid-store commands stop their owned process group at the bounded timeout", async () => {
  assert.equal(INVALID_STORE_CLEANUP_TIMEOUT_MS, 120_000);
  assert.equal(INVALID_STORE_QUERY_TIMEOUT_MS, 30_000);
  assert.equal(INVALID_STORE_SHUTDOWN_MARGIN_MS, 5_000);
  const result = await runInvalidStoreCleanupCommand(
    "bash",
    ["--noprofile", "--norc", "-c", "sleep 30"],
    20,
  );
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.errorLines.join("\n"), /timed out after 20ms/);
});

test("cleanup refuses to start a child without aggregate shutdown margin", () => {
  assert.equal(invalidStoreChildTimeoutMs(20_000, 30_000, 1, 1_000), 14_000);
  assert.throws(() => invalidStoreChildTimeoutMs(6_000, 30_000, 1, 1_000), /aggregate deadline/);
});

test("cleanup aggregate deadline fails closed before checking every candidate", async () => {
  const second = `/nix/store/${"c".repeat(32)}-${name}`;
  let deleted = false;
  await assert.rejects(
    cleanupChangedOwnedInvalidPnpmStores({
      derivationName: name,
      before: new Map(),
      timeoutMs: 20,
      deps: deps({
        listStoreEntries: async () =>
          [owned, second].map((storePath) => storePath.slice("/nix/store/".length)),
        referrers: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return [];
        },
        deletePath: async () => void (deleted = true),
      }),
    }),
    /aggregate deadline/,
  );
  assert.equal(deleted, false);
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
