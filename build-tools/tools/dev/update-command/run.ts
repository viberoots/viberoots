import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";
import { discoverImportersWithLock } from "../install/importers";
import { runGlue } from "../install/glue";
import { reconcilePnpmStore } from "../intentional-pnpm-store-reconcile";
import { repairGoDependencies, repairPythonDependencies } from "./languages";
import { updatePnpmLock } from "./pnpm";
import { unsupportedUpgradeSurfaces } from "./surfaces";

export type UpdateOperations = {
  importers: (root: string) => Promise<string[]>;
  unsupportedUpgrades: (root: string) => Promise<string[]>;
  repairPnpmLock: (root: string, importer: string) => Promise<void>;
  upgradePnpm: (root: string, importer: string) => Promise<void>;
  reconcilePnpm: (root: string, importer: string) => Promise<void>;
  repairGo: (root: string, verbose: boolean) => Promise<void>;
  repairPython: (root: string, verbose: boolean) => Promise<void>;
  repairWorkspaceLock: (root: string, verbose: boolean) => Promise<void>;
  repairCpp: (verbose: boolean) => Promise<void>;
};

export const defaultUpdateOperations: UpdateOperations = {
  importers: async (root) =>
    (await discoverImportersWithLock(root, { cwd: process.cwd() })).filter(
      (importer) => importer !== "viberoots",
    ),
  unsupportedUpgrades: unsupportedUpgradeSurfaces,
  repairPnpmLock: async (root, importer) =>
    await updatePnpmLock({ root, importer, upgrade: false }),
  upgradePnpm: async (root, importer) => await updatePnpmLock({ root, importer, upgrade: true }),
  reconcilePnpm: async (root, importer) => await reconcilePnpmStore({ repoRoot: root, importer }),
  repairGo: repairGoDependencies,
  repairPython: repairPythonDependencies,
  repairWorkspaceLock: async (root, verbose) => {
    await repairGeneratedWorkspaceLock({ workspaceRoot: root, dryRun: false, verbose });
  },
  repairCpp: async (verbose) => await runGlue(false, verbose),
};

export async function runUpdateCommand(opts: {
  root: string;
  upgrade: boolean;
  verbose: boolean;
  operations?: UpdateOperations;
}): Promise<void> {
  const operations = opts.operations || defaultUpdateOperations;
  if (opts.upgrade) {
    const unsupported = await operations.unsupportedUpgrades(opts.root);
    if (unsupported.length > 0) {
      throw new Error(
        `u --upgrade is unsupported for project surface(s): ${unsupported.join(", ")}\nno files were modified`,
      );
    }
  }

  const importers = await operations.importers(opts.root);
  for (const importer of importers) {
    if (opts.verbose) console.log(`[update] pnpm: ${importer}`);
    if (opts.upgrade) await operations.upgradePnpm(opts.root, importer);
    else await operations.repairPnpmLock(opts.root, importer);
    await operations.reconcilePnpm(opts.root, importer);
  }
  await operations.repairGo(opts.root, opts.verbose);
  await operations.repairPython(opts.root, opts.verbose);
  await operations.repairWorkspaceLock(opts.root, opts.verbose);
  await operations.repairCpp(opts.verbose);
}
