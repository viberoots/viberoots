#!/usr/bin/env zx-wrapper
import { scanFlatPatchDirToLowercaseKeyToPatchPathMap } from "../../lib/effective-set-patch-selection";
import { findImporterLockfiles, listImporterPatches } from "../../lib/importers";
import { importerScopedProviderContractForLang } from "../../lib/lang-contracts";
import { syncImporterProviders, type ParseEffectiveSetFn } from "../../lib/provider-sync-driver";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";

export type ImporterScopedProviderSyncOptions = {
  lang: string;
  lockfileBasenames: string[];
  parseEffectiveSetForLockfile: ParseEffectiveSetFn;
  decodePatchKey: (filename: string) => string | null;
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
  discoverLockfiles?: () => Promise<string[]>;
  listImporterPatchesFor?: (importer: string) => Promise<string[]>;
};

export async function syncImporterScopedProviders(
  opts: ImporterScopedProviderSyncOptions,
): Promise<void> {
  const contract = importerScopedProviderContractForLang(opts.lang);
  if (!contract) {
    throw new Error(`[providers] missing importer-scoped provider contract for ${opts.lang}`);
  }

  const outFile = opts.outFile || providerAutoTargetsPath(opts.lang);
  const strict = opts.strict ?? contract.providerSyncParsing.defaultStrict;
  const discoverLockfiles =
    opts.discoverLockfiles || (() => findImporterLockfiles(opts.lockfileBasenames));
  const listImporterPatchesFor =
    opts.listImporterPatchesFor || ((importer) => listImporterPatches(importer, opts.lang));
  const patchDir = opts.patchDir || contract.globalPatchDir?.path;

  const globalKeyToPatchPath =
    contract.globalPatchDir && patchDir
      ? await scanFlatPatchDirToLowercaseKeyToPatchPathMap({
          patchDir,
          decodeKey: opts.decodePatchKey,
        })
      : undefined;

  await syncImporterProviders({
    lang: opts.lang,
    discoverLockfiles,
    parseEffectiveSetForLockfile: opts.parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey: opts.decodePatchKey,
    importerPatchInclusionPolicy: contract.importerPatchInclusionPolicy,
    globalKeyToPatchPath,
    outFile,
    strict,
  });
}
