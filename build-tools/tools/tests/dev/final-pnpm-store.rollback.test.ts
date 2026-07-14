import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileFixedPnpmStore } from "../../dev/update-pnpm-hash/fixed-store-reconcile";

const hashA = `sha256-${Buffer.alloc(32, 1).toString("base64")}`;
const hashB = `sha256-${Buffer.alloc(32, 2).toString("base64")}`;
const lockHash = "a".repeat(64);
const derivationName = `pnpm-store-lock-${lockHash}`;

function mismatch(specified: string, got: string): string {
  return [
    `error: hash mismatch in fixed-output derivation '/nix/store/${"b".repeat(32)}-${derivationName}.drv':`,
    `         specified: ${specified}`,
    `            got:    ${got}`,
    "",
  ].join("\n");
}

test("a thrown verification build restores metadata and preserves the original error", async () => {
  const original = new Error("verification snapshot failed");
  let calls = 0;
  let restored = 0;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, output: mismatch(hashA, hashB) };
        throw original;
      },
      updateHash: async () => {},
      restoreMetadata: async () => void (restored += 1),
    }),
    (error) => error === original,
  );
  assert.equal(restored, 1);
});

test("thrown verification and rollback failures remain visible together", async () => {
  const original = new Error("verification snapshot failed");
  const rollback = new Error("rollback write failed");
  let calls = 0;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, output: mismatch(hashA, hashB) };
        throw original;
      },
      updateHash: async () => {},
      restoreMetadata: async () => {
        throw rollback;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /metadata rollback failed/);
      assert.deepEqual(error.errors, [original, rollback]);
      assert.equal(error.cause, original);
      assert.doesNotMatch(error.message, /restored prior metadata/);
      return true;
    },
  );
});

test("returned verification and rollback failures remain visible together", async () => {
  const rollback = new Error("rollback write failed");
  let calls = 0;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => {
        calls += 1;
        return {
          ok: false,
          output: mismatch(calls === 1 ? hashA : hashB, calls === 1 ? hashB : hashA),
        };
      },
      updateHash: async () => {},
      restoreMetadata: async () => {
        throw rollback;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /metadata rollback failed/);
      assert.equal(error.errors[1], rollback);
      assert.match(String(error.errors[0]), /non-deterministic/);
      assert.equal(error.cause, error.errors[0]);
      assert.doesNotMatch(error.message, /restored prior metadata/);
      return true;
    },
  );
});

test("a partially failed metadata update restores and preserves its error", async () => {
  const original = new Error("metadata write partially failed");
  let restored = 0;
  await assert.rejects(
    reconcileFixedPnpmStore({
      currentHash: hashA,
      expectedDerivationName: derivationName,
      rebuild: false,
      runBuild: async () => ({ ok: false, output: mismatch(hashA, hashB) }),
      updateHash: async () => {
        throw original;
      },
      restoreMetadata: async () => void (restored += 1),
    }),
    (error) => error === original,
  );
  assert.equal(restored, 1);
});
