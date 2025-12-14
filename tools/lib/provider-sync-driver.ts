#!/usr/bin/env zx-wrapper
import path from "node:path";
import { computeImporterLabel, isWorkspaceImporterPath } from "./importers.ts";
import { writeImporterProvidersByLang, type ImporterProvider } from "./provider-writer.ts";
import { toPosixPath, uniqSorted } from "./posix-path.ts";

export type ParseEffectiveSetFn = (
  lockfilePath: string,
  strict?: boolean,
) => Promise<Map<string, Set<string>>>;

export type DriverOptions = {
  lang: "node" | "python" | string;
  discoverLockfiles: () => Promise<string[]>;
  parseEffectiveSetForLockfile: ParseEffectiveSetFn;
  listImporterPatchesFor: (importer: string) => Promise<string[]>;
  decodePatchKey: (filename: string) => string | null;
  outFile?: string;
  strict?: boolean;
  /**
   * When true, include all importer-local patches regardless of effective-set membership.
   * Node wants visibility of importer-local patch files. Python filters by effective set.
   */
  includeAllImporterLocalPatches?: boolean;
  /**
   * Optional global mapping from "<name>@<version>" (lowercased) to absolute or relative patch path.
   * Used by Node to include global patches from patches/node that match the importer’s effective set.
   */
  globalKeyToPatchPath?: Map<string, string>;
};

/**
 * Generic importer-scoped provider sync driver for Node/Python-like ecosystems.
 * Produces ImporterProvider[] and writes standardized TARGETS.*.auto via writer.
 */
export async function runImporterProviderSync(opts: DriverOptions): Promise<void> {
  const {
    lang,
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey,
    outFile,
    strict,
    includeAllImporterLocalPatches,
    globalKeyToPatchPath,
  } = opts;

  // Discover lockfiles and filter to workspace importers under apps/* or libs/*
  const discovered = await discoverLockfiles();
  const lockfiles = discovered.map((p) => toPosixPath(p)).filter((p) => /^(apps|libs)\//.test(p));
  if (!lockfiles.length) {
    await writeImporterProvidersByLang(lang, [], { outFile });
    return;
  }

  const providers: ImporterProvider[] = [];

  for (const lfRaw of lockfiles) {
    const lf = toPosixPath(lfRaw);
    // Parse mapping: importer -> Set("<name>@<version>")
    let importerSets: Map<string, Set<string>> = new Map();
    try {
      importerSets = await parseEffectiveSetForLockfile(lf, strict);
    } catch (e) {
      // Fall back to single importer derived from path when parsing fails and not strict
      if (strict) throw e;
      importerSets = new Map([[computeImporterLabel(lf), new Set()]]);
    }
    // If parser yielded nothing, still emit one provider keyed by the importer label from the path
    if (importerSets.size === 0) {
      importerSets.set(computeImporterLabel(lf), new Set());
    }

    for (const [importerRaw, eff] of importerSets.entries()) {
      const importer = toPosixPath(importerRaw);
      if (!isWorkspaceImporterPath(importer)) continue;

      // Importer-local patches
      const localPatches = await listImporterPatchesFor(importer);
      const localSelected =
        includeAllImporterLocalPatches === true
          ? localPatches
          : localPatches.filter((p) => {
              const base = path.posix.basename(p);
              const key = decodePatchKey(base);
              return !!key && eff.has(String(key).toLowerCase());
            });

      // Global patches that match the effective set (optional)
      const globalSelected: string[] = [];
      if (globalKeyToPatchPath && globalKeyToPatchPath.size > 0) {
        for (const k of eff) {
          const pathFor = globalKeyToPatchPath.get(String(k).toLowerCase());
          if (pathFor) globalSelected.push(toPosixPath(pathFor));
        }
      }

      const patchPaths = uniqSorted([...localSelected, ...globalSelected]);
      providers.push({ lockfile: lf, importer, patchPaths });
    }
  }

  await writeImporterProvidersByLang(lang, providers, { outFile });
}

export default runImporterProviderSync;

// Back-compat alias (some modules may import the older name)
export const syncImporterProviders = runImporterProviderSync;
