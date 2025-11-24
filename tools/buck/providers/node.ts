#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { renderTargetsFile, writeIfChanged, maybeAssumeUnchanged } from "../../lib/fs-helpers.ts";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { providerNameForImporter, decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { findPnpmLockfiles } from "../../lib/lockfiles.ts";
import { parsePnpmLock, effectiveSetForImporter } from "../../lib/pnpm-lock.ts";
import { ensureAutoSection } from "../../lib/auto-section.ts";
import { computeImporterLabel, listImporterPatches } from "../../lib/importers.ts";
import { writeImporterProviders, type ImporterProvider } from "../../lib/provider-writer.ts";

export async function syncNodeProviders(opts?: { outFile?: string; patchDir?: string }) {
  const PATCH_DIR = opts?.patchDir || "patches/node";
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.node.auto";

  const lockfiles = await findPnpmLockfiles();

  async function haveYaml(): Promise<boolean> {
    try {
      await import("yaml");
      return true;
    } catch {
      return false;
    }
  }

  if (!lockfiles.length) {
    // Write deterministic, header-only file via shared writer
    await writeImporterProviders([], {
      outFile: OUT_FILE,
      ruleLoad: 'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      ruleName: "node_importer_deps",
      autoSection: {
        begin: "# BEGIN AUTO_NODE",
        end: "# END AUTO_NODE",
        header: 'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      },
    });
    return;
  }

  const haveYamlMod = await haveYaml();

  const scanned = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    decodeKey: decodeNameVersionFromPatch,
    // Ensure deterministic ordering regardless of filesystem readdir order
    nameForKey: (k) => k,
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  const providers: ImporterProvider[] = [];

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    // Only generate providers for app/lib importers; skip repo-root lockfile
    if (!/^(apps|libs)\//.test(relLf)) continue;
    if (haveYamlMod) {
      const doc = await parsePnpmLock(lf);
      for (const importer of Object.keys(doc.importers || {})) {
        let importerLabel =
          importer === "." ? computeImporterLabel(lf) : importer.replace(/^\.\/+/, "") || ".";
        const eff = effectiveSetForImporter(doc, importer);
        const usedPatches = Array.from(eff)
          .map((k) => keyToPatchPath.get(k) || "")
          .filter(Boolean)
          .sort();
        // Discover importer-local patches for visibility (does not affect invalidation)
        const importerLocalPatches = await listImporterPatches(importerLabel, "node");
        const patchPaths = Array.from(
          new Set<string>([...usedPatches, ...importerLocalPatches]),
        ).sort();
        providers.push({ lockfile: relLf, importer: importerLabel, patchPaths });
      }
    } else {
      // No YAML available: still create a provider per lockfile with importer derived from path
      const importerLabel = path.dirname(relLf) || ".";
      providers.push({ lockfile: relLf, importer: importerLabel, patchPaths: [] });
    }
  }

  await writeImporterProviders(providers, {
    outFile: OUT_FILE,
    ruleLoad: 'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
    ruleName: "node_importer_deps",
    autoSection: {
      begin: "# BEGIN AUTO_NODE",
      end: "# END AUTO_NODE",
      header: 'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
    },
  });
}

// Minimal surface for provider index generation
export async function readNodeProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const out: Array<{ provider: string; key: string }> = [];
  const lockfiles = await findPnpmLockfiles();
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
