#!/usr/bin/env zx-wrapper
import { computeImporterLabel, isWorkspaceImporterPath } from "../../lib/importers.ts";
import { findUvLockfiles } from "../../lib/lockfiles.ts";
import { readImporterProviderIndexEntries } from "../../lib/provider-index.ts";
import { syncImporterProviders } from "../../lib/provider-sync-driver.ts";
import { decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";

export async function syncPythonProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.python.auto";
  const STRICT = opts?.strict ?? false;

  const discoverLockfiles = () => findUvLockfiles();
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
    includeAllImporterLocalPatches: false, // Python filters by effective set
    outFile: OUT_FILE,
    strict: STRICT,
  });
}

export default syncPythonProviders;

// Minimal surface for provider index generation (PR‑13)
export async function readPythonProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const entries = await readImporterProviderIndexEntries({
    discoverLockfiles: async () => findUvLockfiles(),
    importersForLockfile: async (_lf: string) => ["."], // single importer per uv.lock (dirname)
    shouldInclude: (_lf: string, importerLabel: string) => isWorkspaceImporterPath(importerLabel),
  });
  return entries;
}
