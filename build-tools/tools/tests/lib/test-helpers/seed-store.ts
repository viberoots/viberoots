import path from "node:path";
import { assertRequiredSeedFiles, copySeedStoreToTempRepo } from "./seed-copy";
import {
  configuredSeedStore,
  preflightConfiguredSeedForTempRepo,
  requireSeedPath,
} from "./seed-store-config";
import { requireSeedStoreCow } from "./seed-store-cow";
import { overlayActiveViberootsIntoTempRepo } from "./seed-viberoots-overlay";
import { overlayWorktreeIntoTempRepo } from "./seed-worktree-overlay";
import "./worker-init";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;
type SeedDeps = { rsyncRepoTo: (dst: string) => Promise<void>; timeAsync: TimeAsync };
export type RepoInitMode = "rsync" | "seed-store";
export type RepoInitResult = { mode: RepoInitMode; touchedRelPaths: string[] };
export { preflightConfiguredSeedForTempRepo } from "./seed-store-config";

export async function initTempRepoFromSeedStore(args: {
  tmpDir: string;
  deps: SeedDeps;
}): Promise<RepoInitResult> {
  const { tmpDir, deps } = args;
  const config = configuredSeedStore();
  if (config.mode === "rsync") {
    await deps.rsyncRepoTo(tmpDir);
    return { mode: "rsync", touchedRelPaths: [] };
  }
  await requireSeedPath(config.seedPath, config.seedKey);
  await assertRequiredSeedFiles(config.seedPath, "seed store", { allowMissingToolRoot: true });
  await requireSeedStoreCow({ timeAsync: deps.timeAsync, seedPath: config.seedPath, tmpDir });
  const touchedRelPaths: string[] = [];
  await deps.timeAsync(`seedStoreCopy(${path.basename(tmpDir)})`, async () => {
    await copySeedStoreToTempRepo({ seedPath: config.seedPath, tmpDir });
  });
  await deps.timeAsync(`seedOverlayUntracked(${path.basename(tmpDir)})`, async () => {
    touchedRelPaths.push(...(await overlayWorktreeIntoTempRepo(tmpDir)));
  });
  await deps.timeAsync(`seedOverlayViberoots(${path.basename(tmpDir)})`, async () => {
    touchedRelPaths.push(...(await overlayActiveViberootsIntoTempRepo(tmpDir)));
  });
  await assertRequiredSeedFiles(tmpDir, "seed copy");
  return {
    mode: "seed-store",
    touchedRelPaths: Array.from(new Set(touchedRelPaths)).sort((a, b) => a.localeCompare(b)),
  };
}
