#!/usr/bin/env zx-wrapper
import path from "node:path";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { decodeNameVersionFromPatch, providerNameForImporter } from "../../lib/providers.ts";
import { findImporterLockfiles, computeImporterLabel } from "../../lib/importers.ts";
import { parsePnpmLock, effectiveSetForImporter } from "../../lib/pnpm-lock.ts";
import { writeImporterProvidersByLang } from "../../lib/provider-writer.ts";
import { syncImporterProviders } from "../../lib/provider-sync-driver.ts";

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
  const discoverLockfiles = () => findImporterLockfiles(["pnpm-lock.yaml"]);
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
    const map = new Map<string, Set<string>>();
    for (const importer of Object.keys(doc.importers || {})) {
      const importerLabel =
        importer === "."
          ? computeImporterLabel(lockfilePath)
          : importer.replace(/^\.\/+/, "") || ".";
      map.set(importerLabel, effectiveSetForImporter(doc, importer));
    }
    return map;
  };
  const listImporterPatchesFor = async (importer: string) =>
    (await import("../../lib/importers.ts")).listImporterPatches(importer, "node");

  await syncImporterProviders({
    lang: "node",
    discoverLockfiles,
    parseEffectiveSetForLockfile,
    listImporterPatchesFor,
    decodePatchKey: decodeNameVersionFromPatch,
    includeAllImporterLocalPatches: true, // Node lists importer-local patches regardless of effective set
    globalKeyToPatchPath: keyToPatchPath,
    outFile: OUT_FILE,
  });
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const out: Array<{ provider: string; key: string }> = [];
  const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
  if (!lockfiles.length) return out;
  try {
    await import("yaml");
  } catch {
    return out;
  }

  // Reuse scan to know which patches exist; only needed to mirror provider naming stability
  const scanned = await scanFlatPatchDir({
    patchDir: "patches/node",
    decodeKey: decodeNameVersionFromPatch,
    nameForKey: (k) => k,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    if (!/^(apps|libs)\//.test(relLf)) continue;
    const doc = await parsePnpmLock(lf);
    for (const importer of Object.keys(doc.importers || {})) {
      const importerLabel = importer === "." ? path.dirname(lf) || "." : importer;
      const name = providerNameForImporter(lf, importerLabel);
      out.push({ provider: name, key: `lockfile:${lf}#${importerLabel}` });
    }
  }
  // Deterministic order
  out.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return out;
}
