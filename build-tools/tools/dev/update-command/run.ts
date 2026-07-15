import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";
import { discoverImportersWithLock } from "../install/importers";
import { runGlue } from "../install/glue";
import { reconcilePnpmStore } from "../intentional-pnpm-store-reconcile";
import { repairGoDependencies, repairPythonDependencies } from "./languages";
import { updatePnpmLock } from "./pnpm";
import { projectLanguageSurfaces, type ProjectLanguageId } from "./surfaces";

type LanguageUpdate = (root: string, verbose: boolean, upgrade: boolean) => Promise<number>;

export type UpdateOperations = {
  importers: (root: string) => Promise<string[]>;
  repairPnpmLock: (root: string, importer: string) => Promise<void>;
  upgradePnpm: (root: string, importer: string) => Promise<void>;
  reconcilePnpm: (root: string, importer: string) => Promise<void>;
  enabledLanguages: (root: string) => Promise<ProjectLanguageId[]>;
  languageUpdates: Record<ProjectLanguageId, LanguageUpdate>;
  repairWorkspaceLock: (root: string, verbose: boolean) => Promise<void>;
  repairGeneratedMetadata: (verbose: boolean) => Promise<void>;
};

export const defaultUpdateOperations: UpdateOperations = {
  importers: async (root) => await discoverImportersWithLock(root, { cwd: process.cwd() }),
  repairPnpmLock: async (root, importer) =>
    await updatePnpmLock({ root, importer, upgrade: false }),
  upgradePnpm: async (root, importer) => await updatePnpmLock({ root, importer, upgrade: true }),
  reconcilePnpm: async (root, importer) => await reconcilePnpmStore({ repoRoot: root, importer }),
  enabledLanguages: async (root) => {
    const enabled: ProjectLanguageId[] = [];
    for (const surface of projectLanguageSurfaces) {
      if (await surface.enabled(root)) enabled.push(surface.id);
    }
    return enabled;
  },
  languageUpdates: {
    go: repairGoDependencies,
    python: repairPythonDependencies,
    cpp: async () => 0,
  },
  repairWorkspaceLock: async (root, verbose) => {
    await repairGeneratedWorkspaceLock({ workspaceRoot: root, dryRun: false, verbose });
  },
  repairGeneratedMetadata: async (verbose) => await runGlue(false, verbose),
};

export async function runUpdateCommand(opts: {
  root: string;
  upgrade: boolean;
  verbose: boolean;
  operations?: UpdateOperations;
}): Promise<void> {
  const operations = opts.operations || defaultUpdateOperations;
  const importers = await operations.importers(opts.root);
  let upgradedPnpm = 0;
  for (const importer of importers) {
    if (opts.verbose) console.log(`[update] pnpm: ${importer}`);
    // The nested tool importer owns its committed lockfile. Workspace u only
    // reconciles that lock into the workspace-local exact-store authority.
    if (importer !== "viberoots") {
      if (opts.upgrade) {
        await operations.upgradePnpm(opts.root, importer);
        upgradedPnpm += 1;
      } else await operations.repairPnpmLock(opts.root, importer);
    }
    await operations.reconcilePnpm(opts.root, importer);
  }
  const enabledLanguages = new Set(await operations.enabledLanguages(opts.root));
  const languageCounts = new Map<ProjectLanguageId, number>();
  for (const surface of projectLanguageSurfaces) {
    if (!enabledLanguages.has(surface.id)) continue;
    languageCounts.set(
      surface.id,
      await operations.languageUpdates[surface.id](opts.root, opts.verbose, opts.upgrade),
    );
  }
  await operations.repairWorkspaceLock(opts.root, opts.verbose);
  await operations.repairGeneratedMetadata(opts.verbose);
  if (opts.upgrade) {
    console.log(`[update] pnpm: upgraded ${upgradedPnpm} importer(s)`);
    for (const surface of projectLanguageSurfaces) {
      if (!enabledLanguages.has(surface.id)) continue;
      if (surface.upgradePolicy === "reconcile-only") {
        console.log(
          `[update] ${surface.displayName}: reconciliation-only (no upgradeable dependency authority)`,
        );
      } else {
        console.log(
          `[update] ${surface.displayName}: upgraded ${languageCounts.get(surface.id) || 0} ${surface.countNoun}(s)`,
        );
      }
    }
  }
}
