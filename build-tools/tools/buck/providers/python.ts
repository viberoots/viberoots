#!/usr/bin/env zx-wrapper
import { computeImporterLabel, isSupportedImporterLabel } from "../../lib/importers";
import { lockfileBasenamesForLang } from "../../lib/lockfiles";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../../lib/provider-index";
import { decodeNameVersionFromPatch } from "../../lib/providers";
import { parseUvLockKeys } from "../../lib/uv-lock";
import { syncImporterScopedProviders } from "./importer-scoped";

export async function syncPythonProviders(opts?: { outFile?: string; strict?: boolean }) {
  const lockfileBasenames = lockfileBasenamesForLang("python") || [];
  if (lockfileBasenames.length === 0) {
    throw new Error("[python providers] missing lockfile basenames for lang: python");
  }
  const parseEffectiveSetForLockfile = async (
    lockfilePath: string,
    strict?: boolean,
  ): Promise<Map<string, Set<string>>> => {
    try {
      const eff = await parseUvLockKeys(lockfilePath);
      return new Map([[computeImporterLabel(lockfilePath), eff]]);
    } catch (e) {
      if (strict) throw e;
      return new Map([[computeImporterLabel(lockfilePath), new Set()]]);
    }
  };

  await syncImporterScopedProviders({
    lang: "python",
    lockfileBasenames,
    parseEffectiveSetForLockfile,
    decodePatchKey: decodeNameVersionFromPatch,
    outFile: opts?.outFile,
    strict: opts?.strict,
  });
}

export default syncPythonProviders;

// Minimal surface for provider index generation (PR‑13)
export async function readPythonProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const lockfileBasenames = lockfileBasenamesForLang("python") || [];
  if (lockfileBasenames.length === 0) {
    throw new Error("[python providers] missing lockfile basenames for lang: python");
  }
  return await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames,
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
}
