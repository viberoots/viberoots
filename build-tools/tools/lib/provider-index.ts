#!/usr/bin/env zx-wrapper
import { computeImporterLabel, findImporterLockfiles, isSupportedImporterLabel } from "./importers";
import { providerNameForImporter } from "./providers";

export type ProviderIndexEntry = { provider: string; key: string };

type DiscoverLockfiles = () => Promise<string[]>;
type ImportersForLockfile = (lockfilePath: string) => Promise<string[]>;
type ShouldInclude = (lockfilePath: string, importerLabel: string) => boolean;

function normalizeImporterLabel(lockfilePath: string, importer: string): string {
  if (!importer || importer === ".") return computeImporterLabel(lockfilePath);
  // Drop any leading ./ and ensure POSIX style; computeImporterLabel already handles '.'
  return importer.replace(/^\.\/+/, "") || ".";
}

/**
 * Collect provider index entries (provider label tails and keys) for importer-scoped lockfiles.
 *
 * Language-specific call sites provide:
 *  - how to discover lockfiles
 *  - how to enumerate importer labels for each lockfile
 *  - optional filter to include/exclude importers
 *
 * Behavior:
 *  - Normalizes importer labels ('.' → dirname(lockfile), strip './' prefixes)
 *  - Assembles provider names deterministically
 *  - Sorts output by provider name for stable ordering
 */
export async function collectProviderIndexEntries(opts: {
  discoverLockfiles: DiscoverLockfiles;
  importersForLockfile: ImportersForLockfile;
  shouldInclude?: ShouldInclude;
}): Promise<ProviderIndexEntry[]> {
  const { discoverLockfiles, importersForLockfile } = opts;
  const include = opts.shouldInclude || (() => true);
  const lockfiles = await discoverLockfiles();
  const out: ProviderIndexEntry[] = [];
  for (const lf of lockfiles) {
    const importers = await importersForLockfile(lf);
    for (const rawImp of importers) {
      const importer = normalizeImporterLabel(lf, rawImp);
      if (!include(lf, importer)) continue;
      const provider = providerNameForImporter(lf, importer);
      out.push({ provider, key: `lockfile:${lf}#${importer}` });
    }
  }
  out.sort((a, b) => a.provider.localeCompare(b.provider));
  return out;
}

export async function readImporterProviderIndexEntries(opts: {
  discoverLockfiles: DiscoverLockfiles;
  importersForLockfile: ImportersForLockfile;
  shouldInclude?: ShouldInclude;
}): Promise<ProviderIndexEntry[]> {
  return collectProviderIndexEntries(opts);
}

/**
 * Convenience wrapper for importer-scoped ecosystems where each lockfile produces exactly one
 * importer entry derived from the lockfile's directory.
 *
 * This standardizes:
 * - importer enumeration (single importer per lockfile)
 * - optional "required module" gating (e.g., Node requires `yaml` to be present)
 *
 * Call sites provide lockfile discovery and (optionally) filtering for supported importer labels.
 */
export async function readImporterProviderIndexEntriesForSingleImporterLockfiles(opts: {
  discoverLockfiles: DiscoverLockfiles;
  shouldInclude?: ShouldInclude;
  requireNodeModule?: string;
  onMissingRequiredModule?: "return-empty" | "throw";
}): Promise<ProviderIndexEntry[]> {
  const req = String(opts.requireNodeModule || "").trim();
  if (req) {
    try {
      await import(req);
    } catch (e) {
      const mode = opts.onMissingRequiredModule || "return-empty";
      if (mode === "return-empty") return [];
      throw e;
    }
  }

  return collectProviderIndexEntries({
    discoverLockfiles: opts.discoverLockfiles,
    importersForLockfile: async (_lf: string) => ["."],
    shouldInclude: opts.shouldInclude,
  });
}

/**
 * Opinionated helper for importer-scoped languages that have exactly one importer per lockfile
 * (derived from dirname(lockfile)), use shared lockfile discovery, and default to supported-importer
 * filtering.
 */
export async function readImporterProviderIndexEntriesForSingleImporterLockfileBasenames(opts: {
  lockfileBasenames: string[];
  shouldInclude?: ShouldInclude;
  requireNodeModule?: string;
  onMissingRequiredModule?: "return-empty" | "throw";
}): Promise<ProviderIndexEntry[]> {
  const shouldInclude =
    opts.shouldInclude ||
    ((_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel));
  return readImporterProviderIndexEntriesForSingleImporterLockfiles({
    discoverLockfiles: async () => findImporterLockfiles(opts.lockfileBasenames),
    shouldInclude,
    requireNodeModule: opts.requireNodeModule,
    onMissingRequiredModule: opts.onMissingRequiredModule,
  });
}
