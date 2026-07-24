import type { SharedPnpmStoreHashCacheEntry } from "./verified-marker";

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

export async function withSharedPnpmStoreReconciliation(opts: {
  force: boolean;
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  restore: () => Promise<SharedPnpmStoreHashCacheEntry | null>;
  probe: () => Promise<string>;
  acceptRestored: (entry: SharedPnpmStoreHashCacheEntry, probedIdentity: string) => Promise<void>;
  rejectRestored: () => Promise<void>;
  reconcile: () => Promise<void>;
}): Promise<"restored" | "reconciled"> {
  return await opts.withLock(async () => {
    if (!opts.force) {
      const restored = await opts.restore();
      if (restored) {
        try {
          const probedIdentity = await opts.probe();
          if (probedIdentity !== restored.finalDerivationIdentity) {
            throw new Error(
              `shared pnpm-store identity conflict: probed ${probedIdentity}; expected ${restored.finalDerivationIdentity}`,
            );
          }
          await opts.acceptRestored(restored, probedIdentity);
          return "restored";
        } catch (error) {
          if (!String(error).includes("final pnpm store is not realized")) {
            await opts.rejectRestored();
            throw error;
          }
        }
      }
    }
    await opts.reconcile();
    return "reconciled";
  });
}
