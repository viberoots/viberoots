import path from "node:path";
import { computeImporterLabel, findImporterLockfiles } from "../../lib/importers";
import { removeLegacyImporterPnpmState } from "../../lib/pnpm-state-paths";

export async function cleanupVerifyLegacyPnpmState(root: string): Promise<void> {
  const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
  for (const lockfile of lockfiles) {
    const importer = computeImporterLabel(lockfile);
    const importerAbs = importer === "." ? root : path.join(root, importer);
    await removeLegacyImporterPnpmState(importerAbs);
  }
}
