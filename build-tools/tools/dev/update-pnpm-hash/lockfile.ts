import { makeFilteredFlakeRef as makeScopedFilteredFlakeRef } from "./filtered-flake";
import {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
} from "./importer-lockfile";
import { withResolvedFinalPnpmStore } from "./realized-store";

export async function makeFilteredFlakeRef(
  repoRoot: string,
  importer?: string,
): Promise<{
  flakeRef: string;
  workspaceRoot: string;
  viberootsInputRoot: string;
  cleanup: () => Promise<void>;
}> {
  return await makeScopedFilteredFlakeRef({
    repoRoot,
    attr: "pnpm",
    importer,
  });
}

export {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  withResolvedFinalPnpmStore,
};
