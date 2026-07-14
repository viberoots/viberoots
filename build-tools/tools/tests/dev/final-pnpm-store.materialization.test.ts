import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reconcileFixedPnpmStore,
  shouldInspectFixedStoreForRebuild,
  shouldRebuildFixedStore,
} from "../../dev/update-pnpm-hash/fixed-store-reconcile";
import { extractHash } from "../../dev/update-pnpm-hash/nix";

const hashA = `sha256-${Buffer.alloc(32, 1).toString("base64")}`;
const hashB = `sha256-${Buffer.alloc(32, 2).toString("base64")}`;
const lockHash = "a".repeat(64);
const derivationName = `pnpm-store-lock-${lockHash}`;

function mismatch(specified: string, got: string, name = derivationName): string {
  return [
    `error: hash mismatch in fixed-output derivation '/nix/store/${"b".repeat(32)}-${name}.drv':`,
    `         specified: ${specified}`,
    `            got:    ${got}`,
    "",
  ].join("\n");
}

test("fixed-output mismatch parsing requires one targeted pnpm-store block", () => {
  assert.equal(extractHash(mismatch(hashA, hashB), derivationName, hashA), hashB);
  assert.equal(extractHash(`got: ${hashB}\n`, derivationName, hashA), null);
  assert.equal(
    extractHash(mismatch(hashA, hashB, `pnpm-store-lock-${"c".repeat(64)}`), derivationName, hashA),
    null,
  );
  assert.equal(
    extractHash(mismatch(hashA, hashB) + mismatch(hashA, hashB), derivationName, hashA),
    null,
  );
  assert.equal(
    extractHash(mismatch(hashA, hashB) + `  got: ${hashA}\n`, derivationName, hashA),
    null,
  );
  assert.equal(extractHash(mismatch(hashB, hashA), derivationName, hashA), null);
});

test("wrong specified hash cannot trigger metadata mutation", async () => {
  let wrote = false;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => ({ ok: false, output: mismatch(hashB, hashA) }),
      updateHash: async () => void (wrote = true),
      restoreMetadata: async () => {},
    }),
    /without one authoritative Nix hash mismatch/,
  );
  assert.equal(wrote, false);
});

test("force reconciliation builds missing stores normally and rebuilds realized stores", async () => {
  assert.equal(await shouldRebuildFixedStore(async () => "absent"), false);
  assert.equal(await shouldRebuildFixedStore(async () => "realized"), true);
  const calls: boolean[] = [];
  const result = await reconcileFixedPnpmStore({
    currentHash: hashA,
    expectedDerivationName: derivationName,
    rebuild: await shouldRebuildFixedStore(async () => "absent"),
    runBuild: async (rebuild) => {
      calls.push(rebuild);
      return calls.length === 1
        ? { ok: false, output: mismatch(hashA, hashB) }
        : { ok: true, output: "", outPath: "/nix/store/final" };
    },
    updateHash: async () => {},
    restoreMetadata: async () => assert.fail("successful mismatch repair must not roll back"),
  });
  assert.deepEqual(calls, [false, false]);
  assert.equal(result.hash, hashB);
  await assert.rejects(
    shouldRebuildFixedStore(async () => {
      throw new Error("authoritative eval failed");
    }),
    /authoritative eval failed/,
  );
});

test("explicit reconcile inspects only an existing committed fixed store", () => {
  assert.equal(
    shouldInspectFixedStoreForRebuild({ currentHash: "", force: false, markerMatches: false }),
    false,
  );
  assert.equal(
    shouldInspectFixedStoreForRebuild({
      currentHash: "not-a-hash",
      force: true,
      markerMatches: false,
    }),
    false,
  );
  assert.equal(
    shouldInspectFixedStoreForRebuild({
      currentHash: hashA,
      force: false,
      markerMatches: false,
    }),
    true,
  );
  assert.equal(
    shouldInspectFixedStoreForRebuild({ currentHash: hashA, force: false, markerMatches: true }),
    false,
  );
});

test("fixed-store reconciliation updates once and verifies a fresh build", async () => {
  const calls: boolean[] = [];
  const writes: string[] = [];
  const result = await reconcileFixedPnpmStore({
    currentHash: hashA,
    expectedDerivationName: derivationName,
    rebuild: true,
    runBuild: async (rebuild) => {
      calls.push(rebuild);
      return calls.length === 1
        ? { ok: false, output: mismatch(hashA, hashB) }
        : { ok: true, output: "", outPath: "/nix/store/final" };
    },
    updateHash: async (hash) => void writes.push(hash),
    restoreMetadata: async () => assert.fail("successful verification must not roll back"),
  });
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(writes, [hashB]);
  assert.deepEqual(result, { hash: hashB, outPath: "/nix/store/final" });
});

test("a differing second mismatch restores metadata and fails closed", async () => {
  let calls = 0;
  let restored = 0;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => {
        calls += 1;
        return {
          ok: false,
          output: mismatch(hashA, calls === 1 ? hashA : hashB),
        };
      },
      updateHash: async () => {},
      restoreMetadata: async () => void (restored += 1),
    }),
    /non-deterministic.*restored prior metadata/,
  );
  assert.equal(restored, 1);
});

test("failure without one authoritative mismatch does not mutate metadata", async () => {
  let wrote = false;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => ({ ok: false, output: `error mentioning ${hashB}` }),
      updateHash: async () => void (wrote = true),
      restoreMetadata: async () => {},
    }),
    /without one authoritative Nix hash mismatch/,
  );
  assert.equal(wrote, false);
});
