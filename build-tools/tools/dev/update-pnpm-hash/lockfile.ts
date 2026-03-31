import { prepareExactPnpmStore, withExactPrefetchedStore } from "./exact-store.ts";
import { makeFilteredFlakeRef as makeScopedFilteredFlakeRef } from "./filtered-flake.ts";
import {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
} from "./importer-lockfile.ts";
import { withResolvedExactPrefetchedStore } from "./realized-store.ts";

export async function makeFilteredFlakeRef(repoRoot: string): Promise<{
  flakeRef: string;
  cleanup: () => Promise<void>;
}> {
  return await makeScopedFilteredFlakeRef({
    repoRoot,
    attr: "pnpm",
  });
}

export {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  prepareExactPnpmStore,
  withExactPrefetchedStore,
  withResolvedExactPrefetchedStore,
};
