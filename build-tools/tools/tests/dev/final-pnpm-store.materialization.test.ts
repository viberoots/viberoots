import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  reconcileFixedPnpmStore,
  shouldInspectFixedStoreForRebuild,
  shouldRebuildFixedStore,
} from "../../dev/update-pnpm-hash/fixed-store-reconcile";
import {
  hashOwnerForLockfile,
  snapshotNodeModulesHashesJson,
  updateNodeModulesHashesJson,
} from "../../dev/update-pnpm-hash/hashes-json";
import { extractHash } from "../../dev/update-pnpm-hash/nix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

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

test("standalone source root owns its root hash through current symlink", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-hash-owner-"));
  try {
    await fsp.mkdir(path.join(root, "build-tools/tools/dev"), { recursive: true });
    await fsp.mkdir(path.join(root, "build-tools/tools/nix"), { recursive: true });
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.writeFile(path.join(root, "build-tools/tools/dev/zx-init.mjs"), "");
    await fsp.writeFile(path.join(root, "build-tools/tools/nix/node-modules.hashes.json"), "{}\n");
    await fsp.symlink("..", path.join(root, ".viberoots/current"));

    assert.equal(hashOwnerForLockfile("pnpm-lock.yaml", root, "."), "viberoots");
    const snapshot = await snapshotNodeModulesHashesJson("pnpm-lock.yaml", {
      owner: "viberoots",
      root,
    });
    await updateNodeModulesHashesJson("pnpm-lock.yaml", hashA, {
      owner: "viberoots",
      root,
    });
    await snapshot.restore();
    assert.equal(
      await fsp.readFile(path.join(root, "build-tools/tools/nix/node-modules.hashes.json"), "utf8"),
      "{}\n",
    );
    await assert.rejects(fsp.stat(path.join(root, "projects/node-modules.hashes.json")), {
      code: "ENOENT",
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("parent viberoots importer updates the nested canonical map only", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-parent-hash-owner-"));
  const nestedMap = path.join(root, "viberoots/build-tools/tools/nix/node-modules.hashes.json");
  const parentMap = path.join(root, "projects/node-modules.hashes.json");
  try {
    await fsp.mkdir(path.join(root, "viberoots/build-tools/tools/dev"), { recursive: true });
    await fsp.mkdir(path.dirname(nestedMap), { recursive: true });
    await fsp.mkdir(path.dirname(parentMap), { recursive: true });
    await fsp.writeFile(path.join(root, "viberoots/build-tools/tools/dev/zx-init.mjs"), "");
    await fsp.writeFile(nestedMap, "{}\n");
    await fsp.writeFile(parentMap, '{"parent":"unchanged"}\n');

    assert.equal(hashOwnerForLockfile("pnpm-lock.yaml", root, "viberoots"), "viberoots");
    await updateNodeModulesHashesJson("pnpm-lock.yaml", hashA, {
      owner: "viberoots",
      root,
    });
    assert.equal(JSON.parse(await fsp.readFile(nestedMap, "utf8"))["pnpm-lock.yaml"], hashA);
    assert.equal(await fsp.readFile(parentMap, "utf8"), '{"parent":"unchanged"}\n');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("metadata snapshot restores non-owner deletions byte-for-byte", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-hash-footprint-"));
  const viberootsMap = path.join(root, "build-tools/tools/nix/node-modules.hashes.json");
  const workspaceMap = path.join(root, "projects/node-modules.hashes.json");
  const beforeViberoots = `{"pnpm-lock.yaml":"${hashA}","viberoots":"keep"}\n`;
  const beforeWorkspace = `{"pnpm-lock.yaml":"${hashA}","workspace":"keep"}\n`;
  try {
    await fsp.mkdir(path.join(root, "build-tools/tools/dev"), { recursive: true });
    await fsp.mkdir(path.dirname(viberootsMap), { recursive: true });
    await fsp.mkdir(path.dirname(workspaceMap), { recursive: true });
    await fsp.writeFile(path.join(root, "build-tools/tools/dev/zx-init.mjs"), "");
    await fsp.writeFile(viberootsMap, beforeViberoots);
    await fsp.writeFile(workspaceMap, beforeWorkspace);

    const snapshot = await snapshotNodeModulesHashesJson("pnpm-lock.yaml", {
      owner: "workspace",
      root,
    });
    await updateNodeModulesHashesJson("pnpm-lock.yaml", hashB, {
      owner: "workspace",
      root,
    });
    assert.doesNotMatch(await fsp.readFile(viberootsMap, "utf8"), /pnpm-lock\.yaml/);
    await snapshot.restore();
    assert.equal(await fsp.readFile(viberootsMap, "utf8"), beforeViberoots);
    assert.equal(await fsp.readFile(workspaceMap, "utf8"), beforeWorkspace);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Nix-native fixed store retains hash authority and ordinary builds cannot fetch", async () => {
  const store = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  const updater = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const nix = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/nix.ts"),
    "utf8",
  );

  assert.match(
    store,
    /if \(hasLockFs \|\| hasLockStore\) then \{[\s\S]*outputHashMode = "recursive";[\s\S]*outputHash = outHash;/,
  );
  assert.match(store, /reconcileAllowed = \(builtins\.getEnv "NIX_PNPM_RECONCILE"\) == "1"/);
  assert.match(store, /"\$PNPM_BIN" fetch/);
  assert.match(store, /--modules-dir "\$modules_dir"/);
  assert.match(store, /rm -rf "\$modules_dir" node_modules/);
  assert.match(store, /final fixed pnpm store is missing/);
  assert.doesNotMatch(store, /mkPnpmStoreUnfixed|pnpm-store-unfixed|add-fixed/);
  assert.match(updater, /withPnpmStoreBuildFlakeRef\([\s\S]*NIX_PNPM_RECONCILE: "1"/);
  assert.match(updater, /if \(readOnly\) \{[\s\S]*await probe\(\);[\s\S]*return;/);
  assert.match(updater, /shouldInspectFixedStoreForRebuild\(/);
  assert.match(updater, /shouldRebuildFixedStore\(inspectForRebuild\)/);
  assert.match(updater, /rebuild: rebuildExisting/);
  assert.match(nix, /"keep-failed",\s*"false"/);
  assert.match(nix, /if \(opts\.rebuild\) args\.push\("--rebuild"\)/);
});
