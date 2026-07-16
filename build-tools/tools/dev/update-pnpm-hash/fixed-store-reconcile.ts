import { extractHash } from "./nix";
import { withPnpmStoreBuildFlakeRef } from "./build-flake";
import * as hashesJson from "./hashes-json";
import { withHeartbeat } from "./heartbeat";
import { buildStore } from "./nix";
import * as verifiedMarker from "./verified-marker";
import { newManagedCommandActivity } from "./activity";

export type FixedStoreBuildResult = { ok: boolean; output: string; outPath?: string };

export async function shouldRebuildFixedStore(
  inspect: () => Promise<"realized" | "absent" | "invalid">,
): Promise<boolean> {
  return (await inspect()) === "realized";
}

export function shouldInspectFixedStoreForRebuild(opts: {
  currentHash: string;
  force: boolean;
  markerMatches: boolean;
}): boolean {
  const hasCommittedHash = /^sha256-[A-Za-z0-9+/]{43}=$/.test(opts.currentHash);
  return hasCommittedHash && (opts.force || !opts.markerMatches);
}

async function restoreMetadataOrThrow(
  restoreMetadata: () => Promise<void>,
  primary: unknown,
): Promise<void> {
  try {
    await restoreMetadata();
  } catch (rollback) {
    throw new AggregateError(
      [primary, rollback],
      "metadata rollback failed after fixed pnpm store reconciliation failure",
      { cause: primary },
    );
  }
}

export async function reconcileFixedPnpmStore(opts: {
  currentHash: string;
  expectedDerivationName: string;
  rebuild: boolean;
  runBuild: (rebuild: boolean) => Promise<FixedStoreBuildResult>;
  updateHash: (hash: string) => Promise<void>;
  restoreMetadata: () => Promise<void>;
}): Promise<{ hash: string; outPath?: string }> {
  const first = await opts.runBuild(opts.rebuild);
  if (first.ok) return { hash: opts.currentHash, outPath: first.outPath };

  const suggested = extractHash(first.output, opts.expectedDerivationName, opts.currentHash);
  if (!suggested) {
    throw new Error(
      `fixed pnpm store reconciliation failed without one authoritative Nix hash mismatch\n\n${first.output}`,
    );
  }

  let second: FixedStoreBuildResult;
  try {
    await opts.updateHash(suggested);
    second = await opts.runBuild(false);
  } catch (error) {
    await restoreMetadataOrThrow(opts.restoreMetadata, error);
    throw error;
  }
  if (second.ok) return { hash: suggested, outPath: second.outPath };

  const secondSuggested = extractHash(second.output, opts.expectedDerivationName, suggested);
  if (secondSuggested && secondSuggested !== suggested) {
    const primary = new Error(
      `fixed pnpm store was non-deterministic: ${suggested} then ${secondSuggested}`,
    );
    await restoreMetadataOrThrow(opts.restoreMetadata, primary);
    throw new Error(
      `fixed pnpm store was non-deterministic: ${suggested} then ${secondSuggested}; restored prior metadata`,
      { cause: primary },
    );
  }
  const primary = new Error(`fixed pnpm store still failed after hash update\n\n${second.output}`);
  await restoreMetadataOrThrow(opts.restoreMetadata, primary);
  throw new Error(
    `fixed pnpm store still failed after hash update; restored prior metadata\n\n${second.output}`,
    { cause: primary },
  );
}

type ProbeResult = { fixedStorePath: string; derivationIdentity: string };

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
  sharedCacheBuilderFingerprint: string;
  probe: () => Promise<ProbeResult>;
  inspectForRebuild: () => Promise<"realized" | "absent" | "invalid">;
}): Promise<void> {
  const persist = async (hashValue: string, derivationIdentity: string) =>
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
      sharedCacheBuilderFingerprint: opts.sharedCacheBuilderFingerprint,
    });

  if (opts.markerMetadataMatches && !opts.force) {
    try {
      const realized = await opts.probe();
      if (opts.marker?.derivationIdentity === realized.derivationIdentity) {
        await persist(opts.currentHash, realized.derivationIdentity);
        console.log(
          `[update-pnpm-hash] importer=${opts.importer} step=skip-marker attr=${opts.storeAttr} lockfile=${opts.key}`,
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
      currentHash: opts.currentHash,
      force: opts.force,
      markerMatches: false,
    })
  ) {
    rebuildExisting = await shouldRebuildFixedStore(opts.inspectForRebuild);
  }

  await verifiedMarker.withSharedHashCacheLock(
    {
      repoRoot: opts.repoRoot,
      builderFingerprint: opts.sharedCacheBuilderFingerprint,
      lockHash: opts.lockHash,
    },
    async () => {
      let effectiveHash = opts.currentHash;
      if (!opts.force) {
        const restored = await verifiedMarker.restoreHashFromSharedCache({
          repoRoot: opts.repoRoot,
          key: opts.key,
          importer: opts.importer,
          storeAttr: opts.storeAttr,
          builderFingerprint: opts.builderFingerprint,
          sharedCacheBuilderFingerprint: opts.sharedCacheBuilderFingerprint,
          existingLockHash: opts.lockHash,
          existingHash: opts.currentHash,
          hasValidExistingHash: Boolean(opts.currentHash),
          hashOwner: opts.hashOwner,
          hashRoot: opts.repoRoot,
        });
        if (restored) {
          effectiveHash = await hashesJson.readNodeModulesHashForLockfile(opts.key, {
            owner: opts.hashOwner,
            root: opts.repoRoot,
          });
          try {
            const realized = await opts.probe();
            if (!effectiveHash)
              throw new Error(`shared hash cache returned no hash for ${opts.key}`);
            await persist(effectiveHash, realized.derivationIdentity);
            return;
          } catch (error) {
            if (!String(error).includes("final pnpm store is not realized")) throw error;
            rebuildExisting = false;
          }
        }
      }

      const metadata = await hashesJson.snapshotNodeModulesHashesJson(opts.key, {
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
      const finalHash =
        reconciled.hash ||
        (await hashesJson.readNodeModulesHashForLockfile(opts.key, {
          owner: opts.hashOwner,
          root: opts.repoRoot,
        }));
      if (!finalHash)
        throw new Error(`fixed pnpm store reconciliation returned no hash for ${opts.key}`);
      const realized = await opts.probe();
      await persist(finalHash, realized.derivationIdentity);
      console.log(`pnpm-store: ${opts.storeAttr} hash updated and build succeeded`);
    },
  );
}
