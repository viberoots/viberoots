import { withPnpmStoreBuildFlakeRef } from "./build-flake";
import * as hashesJson from "./hashes-json";
import { withHeartbeat } from "./heartbeat";
import { buildStore } from "./nix";
import * as verifiedMarker from "./verified-marker";
import { newManagedCommandActivity } from "./activity";
import { reconcileFixedPnpmStore } from "./fixed-store-build";
import {
  shouldInspectFixedStoreForRebuild,
  shouldRebuildFixedStore,
  withSharedPnpmStoreReconciliation,
} from "./reconciliation-policy";

export {
  shouldInspectFixedStoreForRebuild,
  shouldRebuildFixedStore,
  withSharedPnpmStoreReconciliation,
} from "./reconciliation-policy";
export { reconcileFixedPnpmStore, type FixedStoreBuildResult } from "./fixed-store-build";

type ProbeResult = { fixedStorePath: string; derivationIdentity: string };

async function restoreTrackedHashMetadataOrThrow(
  restoreMetadata: () => Promise<void>,
  primary: unknown,
): Promise<void> {
  try {
    await restoreMetadata();
  } catch (rollback) {
    throw new AggregateError(
      [primary, rollback],
      "tracked pnpm hash metadata rollback failed after final reconciliation failure",
      { cause: primary },
    );
  }
}

export async function finalizeFixedPnpmStoreReconciliation(opts: {
  reconciledHash: string;
  readFinalHash: () => Promise<string>;
  probe: () => Promise<ProbeResult>;
  persist: (hashValue: string, derivationIdentity: string) => Promise<void>;
  restoreMetadata: () => Promise<void>;
  key: string;
}): Promise<void> {
  try {
    const finalHash = opts.reconciledHash || (await opts.readFinalHash());
    if (!finalHash)
      throw new Error(`fixed pnpm store reconciliation returned no hash for ${opts.key}`);
    const realized = await opts.probe();
    await opts.persist(finalHash, realized.derivationIdentity);
  } catch (error) {
    await restoreTrackedHashMetadataOrThrow(opts.restoreMetadata, error);
    throw error;
  }
}

export async function runPnpmStoreReconciliation(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  storeAttr: string;
  lockHash: string;
  key: string;
  hashOwner: hashesJson.HashesJsonOwner;
  markerPath: string;
  currentHash: string;
  force: boolean;
  markerMetadataMatches: boolean;
  marker: Awaited<ReturnType<typeof verifiedMarker.readVerifiedMarker>>;
  builderFingerprint: string;
  derivationIdentity: () => Promise<string>;
  probe: () => Promise<ProbeResult>;
  inspectForRebuild: () => Promise<"realized" | "absent" | "invalid">;
}): Promise<void> {
  const persist = async (
    hashValue: string,
    derivationIdentity: string,
    sharedAuthorityDerivationIdentities: string[],
  ) =>
    await verifiedMarker.persistVerifiedHash({
      repoRoot: opts.repoRoot,
      markerPath: opts.markerPath,
      marker: {
        importer: opts.importer,
        lockfile: opts.key,
        lockHash: opts.lockHash,
        hashValue,
        builderFingerprint: opts.builderFingerprint,
        derivationIdentity,
      },
      sharedAuthorityDerivationIdentities,
      finalDerivationIdentity: derivationIdentity,
    });

  if (opts.markerMetadataMatches && !opts.force) {
    try {
      const realized = await opts.probe();
      if (opts.marker?.derivationIdentity === realized.derivationIdentity) {
        await persist(opts.currentHash, realized.derivationIdentity, [realized.derivationIdentity]);
        console.log(
          `[update-pnpm-hash] importer=${opts.importer} step=skip-marker attr=${opts.storeAttr} lockfile=${opts.key}`,
        );
        return;
      }
    } catch (error) {
      if (!String(error).includes("final pnpm store is not realized")) throw error;
    }
  }

  const initialDerivationIdentity = await opts.derivationIdentity();
  let restoreMetadata: (() => Promise<void>) | null = null;

  let rebuildExisting = false;
  if (
    shouldInspectFixedStoreForRebuild({
      currentHash: opts.currentHash,
      force: opts.force,
      markerMatches: false,
    })
  ) {
    rebuildExisting = await shouldRebuildFixedStore(opts.inspectForRebuild);
  }

  await withSharedPnpmStoreReconciliation({
    force: opts.force,
    withLock: async (fn) =>
      await verifiedMarker.withSharedHashCacheLock(
        {
          repoRoot: opts.repoRoot,
          authorityDerivationIdentity: initialDerivationIdentity,
          lockHash: opts.lockHash,
        },
        fn,
      ),
    restore: async () => {
      const cached = await verifiedMarker.readSharedHashCache({
        repoRoot: opts.repoRoot,
        authorityDerivationIdentity: initialDerivationIdentity,
        lockHash: opts.lockHash,
      });
      if (!cached) return null;
      restoreMetadata = (
        await hashesJson.snapshotNodeModulesHashesJson(opts.key, {
          owner: opts.hashOwner,
          root: opts.repoRoot,
        })
      ).restore;
      const restored = await verifiedMarker.restoreHashFromSharedCache({
        repoRoot: opts.repoRoot,
        key: opts.key,
        importer: opts.importer,
        storeAttr: opts.storeAttr,
        authorityDerivationIdentity: initialDerivationIdentity,
        existingLockHash: opts.lockHash,
        existingHash: opts.currentHash,
        hasValidExistingHash: Boolean(opts.currentHash),
        hashOwner: opts.hashOwner,
        hashRoot: opts.repoRoot,
      });
      return restored;
    },
    probe: async () => {
      try {
        const realized = await opts.probe();
        return realized.derivationIdentity;
      } catch (error) {
        if (String(error).includes("final pnpm store is not realized")) rebuildExisting = false;
        throw error;
      }
    },
    acceptRestored: async (entry, probedIdentity) => {
      await persist(entry.hashValue, probedIdentity, [initialDerivationIdentity, probedIdentity]);
    },
    rejectRestored: async () => {
      if (restoreMetadata) await restoreMetadata();
    },
    reconcile: async () => {
      const effectiveHash = await hashesJson.readNodeModulesHashForLockfile(opts.key, {
        owner: opts.hashOwner,
        root: opts.repoRoot,
      });
      const metadata = restoreMetadata
        ? { restore: restoreMetadata }
        : await hashesJson.snapshotNodeModulesHashesJson(opts.key, {
            owner: opts.hashOwner,
            root: opts.repoRoot,
          });
      const runBuild = async (rebuild: boolean) =>
        await withPnpmStoreBuildFlakeRef(
          { repoRoot: opts.repoRoot, importer: opts.importer, baseFlakeRef: opts.flakeRef },
          async (buildFlakeRef, filteredEnv) => {
            const activity = newManagedCommandActivity();
            return await withHeartbeat(
              `importer=${opts.importer} step=fixed-reconcile attr=${opts.storeAttr}`,
              buildStore(
                opts.storeAttr,
                buildFlakeRef,
                activity,
                { ...filteredEnv, NIX_PNPM_RECONCILE: "1" },
                { rebuild, ownedDerivationName: `pnpm-store-lock-${opts.lockHash}` },
              ),
              { activity },
            );
          },
        );
      const reconciled = await reconcileFixedPnpmStore({
        currentHash: effectiveHash || "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        expectedDerivationName: `pnpm-store-lock-${opts.lockHash}`,
        rebuild: rebuildExisting,
        runBuild,
        updateHash: async (hash) =>
          await hashesJson.updateNodeModulesHashesJson(opts.key, hash, {
            owner: opts.hashOwner,
            root: opts.repoRoot,
          }),
        restoreMetadata: metadata.restore,
      });
      await finalizeFixedPnpmStoreReconciliation({
        reconciledHash: reconciled.hash,
        readFinalHash: async () =>
          await hashesJson.readNodeModulesHashForLockfile(opts.key, {
            owner: opts.hashOwner,
            root: opts.repoRoot,
          }),
        probe: opts.probe,
        persist: async (finalHash, derivationIdentity) =>
          await persist(finalHash, derivationIdentity, [
            initialDerivationIdentity,
            derivationIdentity,
          ]),
        restoreMetadata: metadata.restore,
        key: opts.key,
      });
      console.log(`pnpm-store: ${opts.storeAttr} hash updated and build succeeded`);
    },
  });
}
