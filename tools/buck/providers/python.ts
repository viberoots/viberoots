#!/usr/bin/env zx-wrapper
import { computeImporterLabel, isSupportedImporterLabel } from "../../lib/importers.ts";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../../lib/provider-index.ts";
import { decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";
import { syncImporterScopedProviders } from "./importer-scoped.ts";

export async function syncPythonProviders(opts?: { outFile?: string; strict?: boolean }) {
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
    lockfileBasenames: ["uv.lock"],
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
  return await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: ["uv.lock"],
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
}
