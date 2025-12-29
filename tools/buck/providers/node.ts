#!/usr/bin/env zx-wrapper
import { scanFlatPatchDirToLowercaseKeyToPatchPathMap } from "../../lib/effective-set-patch-selection.ts";
import { decodeNameVersionFromPatch, providerNameForImporter } from "../../lib/providers.ts";
import { importerScopedProviderContractForLang } from "../../lib/lang-contracts.ts";
import {
  findImporterLockfiles,
  computeImporterLabel,
  isSupportedImporterLabel,
  findPnpmLockfilesWithSyntheticWorkspaceImporters,
} from "../../lib/importers.ts";
import { parsePnpmLock, effectiveSetForImporter } from "../../lib/pnpm-lock.ts";
import { writeImporterProvidersByLang } from "../../lib/provider-writer.ts";
import { syncImporterProviders } from "../../lib/provider-sync-driver.ts";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../../lib/provider-index.ts";

export async function syncNodeProviders(opts?: { outFile?: string; patchDir?: string }) {
  const contract = importerScopedProviderContractForLang("node");
  if (!contract) {
    throw new Error("[providers][node] missing importer-scoped provider contract");
  }
  const PATCH_DIR = opts?.patchDir || contract.globalPatchDir?.path || "patches/node";
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.node.auto";
  const keyToPatchPath = await scanFlatPatchDirToLowercaseKeyToPatchPathMap({
    patchDir: PATCH_DIR,
    decodeKey: decodeNameVersionFromPatch,
  });

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
    return await findImporterLockfiles(["pnpm-lock.yaml"]);
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
  const listImporterPatchesFor = async (importer: string) =>
    (await import("../../lib/importers.ts")).listImporterPatches(importer, "node");

  await syncImporterProviders({
    lang: "node",
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey: decodeNameVersionFromPatch,
    importerPatchInclusionPolicy: contract.importerPatchInclusionPolicy,
    globalKeyToPatchPath: keyToPatchPath,
    outFile: OUT_FILE,
  });
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  return await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: ["pnpm-lock.yaml"],
    requireNodeModule: "yaml",
    onMissingRequiredModule: "return-empty",
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
}
