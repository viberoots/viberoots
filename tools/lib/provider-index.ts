#!/usr/bin/env zx-wrapper
import { computeImporterLabel } from "./importers.ts";
import { providerNameForImporter } from "./providers.ts";

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
