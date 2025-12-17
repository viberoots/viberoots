#!/usr/bin/env zx-wrapper
import path from "node:path";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { decodeNameVersionFromPatch, providerNameForImporter } from "../../lib/providers.ts";
import {
  findImporterLockfiles,
  computeImporterLabel,
  isSupportedImporterLabel,
  findPnpmLockfilesWithSyntheticWorkspaceImporters,
} from "../../lib/importers.ts";
import { parsePnpmLock, effectiveSetForImporter } from "../../lib/pnpm-lock.ts";
import { writeImporterProvidersByLang } from "../../lib/provider-writer.ts";
import { syncImporterProviders } from "../../lib/provider-sync-driver.ts";
import { readImporterProviderIndexEntries } from "../../lib/provider-index.ts";

export async function syncNodeProviders(opts?: { outFile?: string; patchDir?: string }) {
  const PATCH_DIR = opts?.patchDir || "patches/node";
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.node.auto";
  // Build a global key → patchPath mapping from patches/node to preserve behavior
  const scanned = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    decodeKey: decodeNameVersionFromPatch,
    nameForKey: (k) => k,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key.toLowerCase(), e.patchPath);

  // Construct plugin functions for the shared driver
  // Node-only policy: include synthetic pnpm-lock.yaml paths for workspace importers that have
  // package.json but no lockfile yet (metadata-only provider, stable edges).
  const discoverLockfiles = async (): Promise<string[]> =>
    await findPnpmLockfilesWithSyntheticWorkspaceImporters();
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
  const listImporterPatchesFor = async (importer: string) =>
    (await import("../../lib/importers.ts")).listImporterPatches(importer, "node");

  // Patch inclusion policy (Node):
  // - Provider patch_paths include every importer-local patch file under <importer>/patches/node/*.patch,
  //   even if the patched package is not present in the lockfile effective set.
  // - This keeps invalidation simple and predictable: adding or changing any importer-local Node patch
  //   invalidates that importer's provider and therefore rebuilds/retests Node targets wired to it.
  await syncImporterProviders({
    lang: "node",
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey: decodeNameVersionFromPatch,
    includeAllImporterLocalPatches: true,
    globalKeyToPatchPath: keyToPatchPath,
    outFile: OUT_FILE,
  });
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
  if (!lockfiles.length) return [];
  // Require YAML parser to be available (preserve existing behavior)
  try {
    await import("yaml");
  } catch {
    return [];
  }
  const entries = await readImporterProviderIndexEntries({
    discoverLockfiles: async () => lockfiles,
    // Lockfile-label contract only allows importer '.' for repo-root lockfiles,
    // and requires importer == dirname(lockfilePath) for non-root lockfiles.
    // Represent this consistently by always enumerating a single importer key '.' here.
    // The shared index helper normalizes '.' to computeImporterLabel(lockfilePath).
    importersForLockfile: async (_lf: string) => ["."],
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
  return entries;
}
