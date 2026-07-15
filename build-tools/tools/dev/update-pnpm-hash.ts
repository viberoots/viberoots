#!/usr/bin/env zx-wrapper
import path from "node:path";
import { flakeRefForImporter } from "./install/common";
import { withExclusiveInstallLock } from "./install/lock";
import { newManagedCommandActivity } from "./update-pnpm-hash/activity";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args";
import { withPnpmStoreBuildFlakeRef } from "./update-pnpm-hash/build-flake";
import { resolveUpdatePnpmHashCommandRoot } from "./update-pnpm-hash/command-root";
import {
  reconcileFixedPnpmStore,
  shouldInspectFixedStoreForRebuild,
  shouldRebuildFixedStore,
} from "./update-pnpm-hash/fixed-store-reconcile";
import * as hashesJson from "./update-pnpm-hash/hashes-json";
import { withHeartbeat } from "./update-pnpm-hash/heartbeat";
import {
  assertImporterLockfileFresh,
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
} from "./update-pnpm-hash/importer-lockfile";
import { buildStore } from "./update-pnpm-hash/nix";
import {
  installLockKeyForImporter,
  normalizeImporter,
  pnpmStoreAttrFromImporter,
  repoRelativeLockfilePath,
} from "./update-pnpm-hash/paths";
import {
  evaluatePnpmStoreDerivationIdentity,
  inspectCommittedFinalPnpmStore,
  resolveFinalPnpmStore,
} from "./update-pnpm-hash/realized-store";
import * as verifiedMarker from "./update-pnpm-hash/verified-marker";
import {
  closeManagedCancellationChannel,
  initializeManagedCancellationChannel,
} from "../lib/managed-cancellation";

initializeManagedCancellationChannel();

const PLACEHOLDER_PNPM_STORE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function inner() {
  const { lockfile, force = false, readOnly = false } = parseUpdatePnpmHashArgs();
  if (force && readOnly) {
    throw new Error("update-pnpm-hash --read-only cannot be combined with --force");
  }

  const repoRoot = await resolveUpdatePnpmHashCommandRoot(process.cwd());
  const relLock = repoRelativeLockfilePath(repoRoot, lockfile);
  const importer = normalizeImporter(path.posix.dirname(relLock));
  const key = importer === "viberoots" ? "pnpm-lock.yaml" : relLock;
  const hashOwner = hashesJson.hashOwnerForLockfile(key, repoRoot, importer);
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const flakeRef = flakeRefForImporter(repoRoot, importer);
  const lockAbs = path.join(repoRoot, relLock);
  const markerPath = verifiedMarker.verifiedMarkerPath(repoRoot, importer);

  if (readOnly) {
    await assertImporterLockfileFresh({ repoRoot, importer });
  } else if (importer === ".") {
    if (!readOnly) await ensureImporterLockfileFreshIfAllowed({ repoRoot, importer });
  } else if (!readOnly) {
    await ensureImporterLockfileFresh({ repoRoot, importer });
  }

  const lockHash = await verifiedMarker.sha256File(lockAbs);
  const currentHash = await hashesJson.readNodeModulesHashForLockfile(key, {
    owner: hashOwner,
    root: repoRoot,
  });
  const builderFingerprint = await verifiedMarker.currentVerifiedMarkerFingerprint(
    repoRoot,
    importer,
  );
  const sharedCacheBuilderFingerprint =
    await verifiedMarker.currentSharedPnpmStoreHashCacheFingerprint(repoRoot, importer);
  const acceptedBuilderFingerprints =
    await verifiedMarker.currentVerifiedMarkerFingerprintCandidates(repoRoot, importer);
  const marker = await verifiedMarker.readVerifiedMarker(markerPath);
  const markerMetadataMatches = Boolean(
    currentHash &&
      marker &&
      marker.importer === importer &&
      marker.lockfile === key &&
      marker.lockHash === lockHash &&
      marker.hashValue === currentHash &&
      acceptedBuilderFingerprints.includes(marker.builderFingerprint),
  );

  const probe = async (): Promise<{ fixedStorePath: string; derivationIdentity: string }> =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) => {
        const env = { ...process.env, ...filteredEnv };
        const resolved = await resolveFinalPnpmStore({
          repoRoot,
          importer,
          flakeRef: buildFlakeRef,
          attrPath: storeAttr,
          env,
        });
        const derivationIdentity = await evaluatePnpmStoreDerivationIdentity({
          repoRoot,
          flakeRef: buildFlakeRef,
          attrPath: storeAttr,
          env,
        });
        return { fixedStorePath: resolved.fixedStorePath, derivationIdentity };
      },
    );

  const inspectForRebuild = async (): Promise<"realized" | "absent" | "invalid"> =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) =>
        (
          await inspectCommittedFinalPnpmStore({
            repoRoot,
            importer,
            flakeRef: buildFlakeRef,
            attrPath: storeAttr,
            env: { ...process.env, ...filteredEnv },
          })
        ).status,
    );

  if (readOnly) {
    const realized = await probe();
    if (!markerMetadataMatches || marker?.derivationIdentity !== realized.derivationIdentity) {
      throw new Error(`pnpm-store verification is stale for ${importer}; repair: run u`);
    }
    console.log(`pnpm-store: ${storeAttr} is realized from committed metadata`);
    return;
  }

  const persist = async (hashValue: string, derivationIdentity: string) => {
    await verifiedMarker.persistVerifiedHash({
      repoRoot,
      markerPath,
      marker: {
        importer,
        lockfile: key,
        lockHash,
        hashValue,
        builderFingerprint,
        derivationIdentity,
      },
      sharedCacheBuilderFingerprint,
    });
  };

  let markerMatches = false;
  if (markerMetadataMatches && !force) {
    try {
      const realized = await probe();
      if (marker?.derivationIdentity === realized.derivationIdentity) {
        markerMatches = true;
        await persist(currentHash, realized.derivationIdentity);
        console.log(
          `[update-pnpm-hash] importer=${importer} step=skip-marker attr=${storeAttr} lockfile=${key}`,
        );
        return;
      }
    } catch (error) {
      if (!String(error).includes("final pnpm store is not realized")) throw error;
    }
  }

  let rebuildExisting = false;
  if (
    shouldInspectFixedStoreForRebuild({
      currentHash,
      force,
      markerMatches,
    })
  ) {
    rebuildExisting = await shouldRebuildFixedStore(inspectForRebuild);
  }

  await verifiedMarker.withSharedHashCacheLock(
    { repoRoot, builderFingerprint: sharedCacheBuilderFingerprint, lockHash },
    async () => {
      let effectiveHash = currentHash;
      if (!force) {
        const restored = await verifiedMarker.restoreHashFromSharedCache({
          repoRoot,
          key,
          importer,
          storeAttr,
          builderFingerprint,
          sharedCacheBuilderFingerprint,
          existingLockHash: lockHash,
          existingHash: currentHash,
          hasValidExistingHash: Boolean(currentHash),
          hashOwner,
          hashRoot: repoRoot,
        });
        if (restored) {
          effectiveHash = await hashesJson.readNodeModulesHashForLockfile(key, {
            owner: hashOwner,
            root: repoRoot,
          });
          try {
            const realized = await probe();
            if (!effectiveHash) throw new Error(`shared hash cache returned no hash for ${key}`);
            await persist(effectiveHash, realized.derivationIdentity);
            return;
          } catch (error) {
            if (!String(error).includes("final pnpm store is not realized")) throw error;
            rebuildExisting = false;
          }
        }
      }

      const metadata = await hashesJson.snapshotNodeModulesHashesJson(key, {
        owner: hashOwner,
        root: repoRoot,
      });
      const runBuild = async (rebuild: boolean) =>
        await withPnpmStoreBuildFlakeRef(
          { repoRoot, importer, baseFlakeRef: flakeRef },
          async (buildFlakeRef, filteredEnv) => {
            const activity = newManagedCommandActivity();
            return await withHeartbeat(
              `importer=${importer} step=fixed-reconcile attr=${storeAttr}`,
              buildStore(
                storeAttr,
                buildFlakeRef,
                activity,
                { ...filteredEnv, NIX_PNPM_RECONCILE: "1" },
                {
                  rebuild,
                  ownedDerivationName: `pnpm-store-lock-${lockHash}`,
                },
              ),
              { activity },
            );
          },
        );
      const reconciled = await reconcileFixedPnpmStore({
        currentHash: effectiveHash || PLACEHOLDER_PNPM_STORE_HASH,
        expectedDerivationName: `pnpm-store-lock-${lockHash}`,
        rebuild: rebuildExisting,
        runBuild,
        updateHash: async (hash) =>
          await hashesJson.updateNodeModulesHashesJson(key, hash, {
            owner: hashOwner,
            root: repoRoot,
          }),
        restoreMetadata: metadata.restore,
      });
      const finalHash =
        reconciled.hash ||
        (await hashesJson.readNodeModulesHashForLockfile(key, {
          owner: hashOwner,
          root: repoRoot,
        }));
      if (!finalHash)
        throw new Error(`fixed pnpm store reconciliation returned no hash for ${key}`);
      const realized = await probe();
      await persist(finalHash, realized.derivationIdentity);
      console.log(`pnpm-store: ${storeAttr} hash updated and build succeeded`);
    },
  );
}

async function main() {
  if (String(process.env.INSTALL_LOCK_SKIP || "").trim() === "1") return await inner();
  const { lockfile } = parseUpdatePnpmHashArgs();
  const commandRoot = await resolveUpdatePnpmHashCommandRoot(process.cwd());
  const installLockKey = installLockKeyForImporter(
    normalizeImporter(path.posix.dirname(repoRelativeLockfilePath(commandRoot, lockfile))),
  );
  const lockScopeRaw = String(process.env.WORKSPACE_ROOT || process.env.REPO_ROOT || "").trim();
  const lockScopeRoot =
    lockScopeRaw && path.isAbsolute(lockScopeRaw) ? path.resolve(lockScopeRaw) : commandRoot;
  await withExclusiveInstallLock(installLockKey, inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockScopeRoot,
  });
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closeManagedCancellationChannel);
