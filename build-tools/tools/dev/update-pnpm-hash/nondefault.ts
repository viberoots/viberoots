import { updateNodeModulesHashesJson } from "./hashes-json";
import { generateImporterLockfile, prepareExactPnpmStore } from "./lockfile";
import { extractHash } from "./nix";
import {
  type PnpmStoreVerifiedMarker,
  persistVerifiedHash,
  restoreHashFromSharedCache,
  withSharedHashCacheLock,
} from "./verified-marker";

export async function handleNonDefaultImporter(opts: {
  importer: string;
  key: string;
  repoRoot: string;
  builderFingerprint: string;
  sharedCacheBuilderFingerprint?: string;
  storeAttr: string;
  unfixedAttr: string;
  timeoutSec: string;
  force: boolean;
  markerPath: string;
  hasValidExistingHash: boolean;
  existingHash: string;
  existingLockHash: string;
  existingMarker: PnpmStoreVerifiedMarker | null;
  acceptedBuilderFingerprints?: string[];
  runFixedBuild: (phaseLabel: string) => Promise<{ ok: boolean; output: string; outPath?: string }>;
  runUnfixedBuild: (phaseLabel: string) => Promise<{ ok: boolean; sri?: string; output?: string }>;
  prepareExactStore?: (opts: { repoRoot: string; importer: string }) => Promise<unknown>;
}): Promise<boolean> {
  if (opts.importer === ".") return false;
  let suggestedHash: string | null = null;
  const prepareExactStore = opts.prepareExactStore || prepareExactPnpmStore;
  const persistHash = async (hashValue: string) => {
    if (!opts.existingLockHash) return;
    await persistVerifiedHash({
      repoRoot: opts.repoRoot,
      markerPath: opts.markerPath,
      marker: {
        importer: opts.importer,
        lockfile: opts.key,
        lockHash: opts.existingLockHash,
        hashValue,
        builderFingerprint: opts.builderFingerprint,
      },
      sharedCacheBuilderFingerprint: opts.sharedCacheBuilderFingerprint,
    });
  };
  const restoreSharedHash = async () => {
    if (opts.force) return false;
    if (!opts.existingLockHash) return false;
    const restored = await restoreHashFromSharedCache({
      repoRoot: opts.repoRoot,
      key: opts.key,
      markerPath: opts.markerPath,
      importer: opts.importer,
      storeAttr: opts.storeAttr,
      builderFingerprint: opts.builderFingerprint,
      sharedCacheBuilderFingerprint: opts.sharedCacheBuilderFingerprint,
      existingLockHash: opts.existingLockHash,
      existingHash: opts.existingHash,
      hasValidExistingHash: opts.hasValidExistingHash,
    });
    if (restored) {
      await prepareExactStore({ repoRoot: opts.repoRoot, importer: opts.importer });
    }
    return restored;
  };
  const markerMatchesCurrentBuilder =
    opts.existingLockHash &&
    opts.existingMarker &&
    opts.existingMarker.importer === opts.importer &&
    opts.existingMarker.lockfile === opts.key &&
    opts.existingMarker.lockHash === opts.existingLockHash &&
    opts.existingMarker.hashValue === opts.existingHash &&
    (opts.acceptedBuilderFingerprints || [opts.builderFingerprint]).includes(
      opts.existingMarker.builderFingerprint,
    );
  const withSharedHashComputation = async (compute: () => Promise<boolean>) => {
    if (!opts.existingLockHash) return await compute();
    return await withSharedHashCacheLock(
      {
        repoRoot: opts.repoRoot,
        builderFingerprint: opts.sharedCacheBuilderFingerprint || opts.builderFingerprint,
        lockHash: opts.existingLockHash,
      },
      async () => {
        if (await restoreSharedHash()) {
          return true;
        }
        return await compute();
      },
    );
  };
  const verifyExistingHash = async (phasePrefix: string): Promise<boolean> => {
    const verifyExisting = await opts.runFixedBuild(
      `importer=${opts.importer} step=${phasePrefix} attr=${opts.storeAttr}`,
    );
    if (verifyExisting.ok) {
      await persistHash(opts.existingHash);
      await prepareExactStore({ repoRoot: opts.repoRoot, importer: opts.importer });
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=skip-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
      );
      return true;
    }
    if (/does not provide attribute/.test(String(verifyExisting.output || ""))) {
      console.warn(`[update-pnpm-hash] skip: flake attr missing (${opts.storeAttr}); continuing`);
      return true;
    }
    const suggestedFromExisting = extractHash(String(verifyExisting.output || ""));
    if (suggestedFromExisting) {
      await updateNodeModulesHashesJson(opts.key, suggestedFromExisting);
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=${phasePrefix}-after-hash attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
      );
      const verifyAfterHash = await opts.runFixedBuild(
        `importer=${opts.importer} step=${phasePrefix}-after-hash attr=${opts.storeAttr}`,
      );
      if (!verifyAfterHash.ok) {
        console.error(
          "pnpm-store still failing after hash update\n\n" + String(verifyAfterHash.output || ""),
        );
        process.exit(1);
        return true;
      }
      await persistHash(suggestedFromExisting);
      await prepareExactStore({ repoRoot: opts.repoRoot, importer: opts.importer });
      console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
      return true;
    }
    return false;
  };
  if (opts.hasValidExistingHash) {
    if (markerMatchesCurrentBuilder) {
      await persistHash(opts.existingHash);
      await prepareExactStore({ repoRoot: opts.repoRoot, importer: opts.importer });
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=skip-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
      );
      return true;
    }
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=stale-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
    );
    if (opts.existingMarker && !markerMatchesCurrentBuilder) {
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=stale-builder-recompute attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
      );
      return await withSharedHashComputation(async () => {
        let pre = await opts.runUnfixedBuild(
          `importer=${opts.importer} step=stale-builder-recompute attr=${opts.unfixedAttr}`,
        );
        if (!pre.ok) {
          await generateImporterLockfile({ repoRoot: opts.repoRoot, importer: opts.importer });
          pre = await opts.runUnfixedBuild(
            `importer=${opts.importer} step=stale-builder-recompute-retry attr=${opts.unfixedAttr}`,
          );
        }
        if (!pre.ok || !pre.sri) {
          console.error(
            "pnpm-store-unfixed failed during stale builder recompute\n\n" +
              String(pre.output || ""),
          );
          process.exit(1);
          return true;
        }
        await updateNodeModulesHashesJson(opts.key, pre.sri);
        const verifyAfterHash = await opts.runFixedBuild(
          `importer=${opts.importer} step=stale-builder-fixed-after-hash attr=${opts.storeAttr}`,
        );
        if (!verifyAfterHash.ok) {
          const suggestedFromFixed = extractHash(String(verifyAfterHash.output || ""));
          if (suggestedFromFixed && suggestedFromFixed !== pre.sri) {
            await updateNodeModulesHashesJson(opts.key, suggestedFromFixed);
            const retryAfterHash = await opts.runFixedBuild(
              `importer=${opts.importer} step=stale-builder-fixed-after-hash-retry attr=${opts.storeAttr}`,
            );
            if (!retryAfterHash.ok) {
              console.error(
                "pnpm-store still failing after stale builder hash update\n\n" +
                  String(retryAfterHash.output || ""),
              );
              process.exit(1);
              return true;
            }
            await persistHash(suggestedFromFixed);
            console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
            return true;
          }
          console.error(
            "pnpm-store still failing after stale builder hash update\n\n" +
              String(verifyAfterHash.output || ""),
          );
          process.exit(1);
          return true;
        }
        await persistHash(pre.sri);
        console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
        return true;
      });
    }
    if (
      await withSharedHashComputation(async () => {
        return await verifyExistingHash("fixed-build");
      })
    ) {
      return true;
    }
  }
  return await withSharedHashComputation(async () => {
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=fixed-build attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
    );
    const verify = await opts.runFixedBuild(
      `importer=${opts.importer} step=fixed-build attr=${opts.storeAttr}`,
    );
    if (verify.ok) {
      if (opts.hasValidExistingHash) await persistHash(opts.existingHash);
      console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
      return true;
    }
    if (/does not provide attribute/.test(String(verify.output || ""))) {
      console.warn(`[update-pnpm-hash] skip: flake attr missing (${opts.storeAttr}); continuing`);
      return true;
    }
    suggestedHash = extractHash(String(verify.output || ""));
    if (!suggestedHash) {
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
      );
      let pre = await opts.runUnfixedBuild(
        `importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr}`,
      );
      if (!pre.ok) {
        await generateImporterLockfile({ repoRoot: opts.repoRoot, importer: opts.importer });
        console.log(
          `[update-pnpm-hash] importer=${opts.importer} step=unfixed-build-retry attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
        );
        pre = await opts.runUnfixedBuild(
          `importer=${opts.importer} step=unfixed-build-retry attr=${opts.unfixedAttr}`,
        );
      }
      if (!pre.ok || !pre.sri) {
        console.error(
          "pnpm-store-unfixed failed and no SRI hash was produced\n\n" + String(pre.output || ""),
        );
        process.exit(1);
        return true;
      }
      suggestedHash = pre.sri;
    }
    const sri0 = suggestedHash;
    if (!sri0) {
      console.error("pnpm-store hash suggestion unexpectedly missing for non-default importer");
      process.exit(1);
      return true;
    }
    let sri = sri0;
    await updateNodeModulesHashesJson(opts.key, sri);
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
    );
    const verifyAfterHash = await opts.runFixedBuild(
      `importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr}`,
    );
    if (!verifyAfterHash.ok) {
      const suggestedFromFixed = extractHash(String(verifyAfterHash.output || ""));
      if (suggestedFromFixed && suggestedFromFixed !== sri) {
        sri = suggestedFromFixed;
        await updateNodeModulesHashesJson(opts.key, sri);
        const retryAfterHash = await opts.runFixedBuild(
          `importer=${opts.importer} step=fixed-build-after-hash-retry attr=${opts.storeAttr}`,
        );
        if (!retryAfterHash.ok) {
          console.error(
            "pnpm-store still failing after hash update\n\n" + String(retryAfterHash.output || ""),
          );
          process.exit(1);
          return true;
        }
      } else {
        console.error(
          "pnpm-store still failing after hash update\n\n" + String(verifyAfterHash.output || ""),
        );
        process.exit(1);
        return true;
      }
    }
    await persistHash(sri);
    console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
    return true;
  });
}
