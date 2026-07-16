import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  hashOwnerForLockfile,
  snapshotNodeModulesHashesJson,
  updateNodeModulesHashesJson,
} from "../../dev/update-pnpm-hash/hashes-json";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const hashA = `sha256-${Buffer.alloc(32, 1).toString("base64")}`;
const hashB = `sha256-${Buffer.alloc(32, 2).toString("base64")}`;

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
  const reconcile = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts"),
    "utf8",
  );

  assert.match(
    store,
    /if \(hasLockFs \|\| hasLockStore\) then \{[\s\S]*outputHashMode = "recursive";[\s\S]*outputHash = outHash;/,
  );
  assert.match(store, /reconcileAllowed = \(builtins\.getEnv "NIX_PNPM_RECONCILE"\) == "1"/);
  assert.match(store, /materializeAllowed = \(builtins\.getEnv "NIX_PNPM_MATERIALIZE"\) == "1"/);
  assert.match(store, /"\$PNPM_BIN" fetch/);
  assert.match(store, /--modules-dir "\$modules_dir"/);
  assert.match(store, /rm -rf "\$modules_dir" node_modules/);
  assert.match(store, /final fixed pnpm store is missing/);
  assert.doesNotMatch(store, /mkPnpmStoreUnfixed|pnpm-store-unfixed|add-fixed/);
  assert.match(reconcile, /withPnpmStoreBuildFlakeRef\([\s\S]*NIX_PNPM_RECONCILE: "1"/);
  assert.match(
    updater,
    /if \(readOnly\) \{[\s\S]*final pnpm store is not realized[\s\S]*writeVerifiedMarker[\s\S]*return;/,
  );
  assert.doesNotMatch(
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
      "",
    /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson|reconcileFixedPnpmStore/,
  );
  assert.match(reconcile, /shouldInspectFixedStoreForRebuild\(/);
  assert.match(reconcile, /shouldRebuildFixedStore\(opts\.inspectForRebuild\)/);
  assert.match(reconcile, /rebuild: rebuildExisting/);
  assert.match(nix, /"keep-failed",\s*"false"/);
  assert.match(nix, /if \(opts\.rebuild\) args\.push\("--rebuild"\)/);
});
