#!/usr/bin/env zx-wrapper
import {
  computeImporterLabel,
  findImporterLockfiles,
  isSupportedImporterLabel,
} from "../../lib/importers.ts";
import { importerScopedProviderContractForLang } from "../../lib/lang-contracts.ts";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../../lib/provider-index.ts";
import { syncImporterProviders } from "../../lib/provider-sync-driver.ts";
import { decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";

export async function syncPythonProviders(opts?: { outFile?: string; strict?: boolean }) {
  const contract = importerScopedProviderContractForLang("python");
  if (!contract) {
    throw new Error("[providers][python] missing importer-scoped provider contract");
  }
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.python.auto";
  const STRICT = opts?.strict ?? contract.providerSyncParsing.defaultStrict;

  const discoverLockfiles = () => findImporterLockfiles(["uv.lock"]);
  const parseEffectiveSetForLockfile = async (
    lockfilePath: string,
  ): Promise<Map<string, Set<string>>> => {
    try {
      const eff = await parseUvLockKeys(lockfilePath);
      return new Map([[computeImporterLabel(lockfilePath), eff]]);
    } catch (e) {
      if (STRICT) throw e;
      return new Map([[computeImporterLabel(lockfilePath), new Set()]]);
    }
  };
  const listImporterPatchesFor = async (importer: string) =>
    (await import("../../lib/importers.ts")).listImporterPatches(importer, "python");

  await syncImporterProviders({
    lang: "python",
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey: decodeNameVersionFromPatch,
    importerPatchInclusionPolicy: contract.importerPatchInclusionPolicy,
    outFile: OUT_FILE,
    strict: STRICT,
  });
}

export default syncPythonProviders;

// Minimal surface for provider index generation (PR‑13)
export async function readPythonProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  return await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: ["uv.lock"],
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
}
