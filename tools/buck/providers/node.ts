#!/usr/bin/env zx-wrapper
import {
  computeImporterLabel,
  findImporterLockfiles,
  findPnpmLockfilesWithSyntheticWorkspaceImporters,
  isSupportedImporterLabel,
} from "../../lib/importers";
import { lockfileBasenamesForLang } from "../../lib/lockfiles";
import { effectiveSetForImporter, parsePnpmLock } from "../../lib/pnpm-lock";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../../lib/provider-index";
import { decodeNameVersionFromPatch } from "../../lib/providers";
import { syncImporterScopedProviders } from "./importer-scoped";

export async function syncNodeProviders(opts?: { outFile?: string; patchDir?: string }) {
  const lockfileBasenames = lockfileBasenamesForLang("node") || [];
  if (lockfileBasenames.length === 0) {
    throw new Error("[node providers] missing lockfile basenames for lang: node");
  }

  function syntheticLockfilesEnabled(): boolean {
    const raw = String(process.env.NODE_PROVIDER_SYNTHETIC_LOCKFILES || "")
      .trim()
      .toLowerCase();
    return raw === "1" || raw === "true";
  }

  // Construct plugin functions for the shared driver
  // Default: discover providers only from real pnpm-lock.yaml files (lockfile-label contract).
  //
  // Opt-in: set NODE_PROVIDER_SYNTHETIC_LOCKFILES=1 to also synthesize pnpm-lock.yaml paths for
  // workspace importers that have package.json but no lockfile yet (metadata-only provider; stable
  // edges during early scaffolding).
  const discoverLockfiles = async (): Promise<string[]> => {
    if (syntheticLockfilesEnabled()) {
      return await findPnpmLockfilesWithSyntheticWorkspaceImporters();
    }
    return await findImporterLockfiles(lockfileBasenames);
  };
  const parseEffectiveSetForLockfile = async (
    lockfilePath: string,
  ): Promise<Map<string, Set<string>>> => {
    // Try YAML; if unavailable, fall back to a single importer derived from path
    try {
      await import("yaml");
    } catch {
      return new Map([[computeImporterLabel(lockfilePath), new Set()]]);
    }
    const doc = await parsePnpmLock(lockfilePath);
    const importerLabel = computeImporterLabel(lockfilePath);
    const importers = doc.importers || {};
    const candidates = [
      ".", // most common for per-importer lockfiles
      importerLabel,
      `./${importerLabel}`,
    ];
    const chosen =
      candidates.find((k) => Object.prototype.hasOwnProperty.call(importers, k)) ||
      (Object.keys(importers).length === 1 ? Object.keys(importers)[0] : ".") ||
      ".";
    const eff = Object.prototype.hasOwnProperty.call(importers, chosen)
      ? effectiveSetForImporter(doc, chosen)
      : new Set<string>();
    return new Map([[importerLabel, eff]]);
  };
  await syncImporterScopedProviders({
    lang: "node",
    lockfileBasenames,
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    decodePatchKey: decodeNameVersionFromPatch,
    outFile: opts?.outFile,
    patchDir: opts?.patchDir,
  });
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const basenames = lockfileBasenamesForLang("node") || [];
  if (basenames.length === 0) {
    throw new Error("[node providers] missing lockfile basenames for lang: node");
  }
  return await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: basenames,
    requireNodeModule: "yaml",
    onMissingRequiredModule: "return-empty",
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
}
