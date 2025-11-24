#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { renderTargetsFile, writeIfChanged, maybeAssumeUnchanged } from "../../lib/fs-helpers.ts";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { providerNameForImporter, decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { ensureAutoSection } from "../../lib/auto-section.ts";
import { findUvLockfiles } from "../../lib/lockfiles.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";
import {
  computeImporterLabel,
  listImporterPatches,
  defaultImporterPatchDir,
} from "../../lib/importers.ts";
import { writeImporterProviders, type ImporterProvider } from "../../lib/provider-writer.ts";

export async function syncPythonProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  // Note: Python patches are importer-local: <importer>/patches/python/*.patch
  // The PATCH_DIR option is ignored for Python to avoid global scanning.
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.python.auto";
  const STRICT = opts?.strict ?? false;

  const lockfiles = await findUvLockfiles();

  // Empty state: still ensure deterministic, header-only file exists
  if (!lockfiles.length) {
    await writeImporterProviders([], {
      outFile: OUT_FILE,
      ruleLoad: 'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
      ruleName: "python_importer_deps",
      autoSection: {
        begin: "# BEGIN AUTO_PYTHON",
        end: "# END AUTO_PYTHON",
        header: 'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
      },
    });
    return;
  }

  const providers: ImporterProvider[] = []; // provider entries we will emit

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    // Only generate providers for known importers under apps/* or libs/*
    if (!/^(apps|libs)\//.test(relLf)) continue;
    const importerLabel = computeImporterLabel(relLf);

    // Parse uv.lock for "<name>@<version>" effective set
    let eff: Set<string> = new Set();
    try {
      eff = await parseUvLockKeys(lf);
    } catch (e) {
      // Be strict only when requested; otherwise, treat as empty
      if (STRICT) throw e;
      eff = new Set();
    }
    // Build importer-local patches directory and collect matching patches
    const allImporterPatches = await listImporterPatches(importerLabel, "python");
    const usedPatches = allImporterPatches.filter((p) => {
      const base = path.posix.basename(p);
      const key = decodeNameVersionFromPatch(base);
      return !!key && eff.has(key);
    });
    usedPatches.sort();

    providers.push({ lockfile: relLf, importer: importerLabel, patchPaths: usedPatches });
  }

  await writeImporterProviders(providers, {
    outFile: OUT_FILE,
    ruleLoad: 'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
    ruleName: "python_importer_deps",
    autoSection: {
      begin: "# BEGIN AUTO_PYTHON",
      end: "# END AUTO_PYTHON",
      header: 'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
    },
  });
}

export default syncPythonProviders;

// Minimal surface for provider index generation (PR‑13)
export async function readPythonProviderIndexEntries(): Promise<
  Array<{ provider: string; key: string }>
> {
  const out: Array<{ provider: string; key: string }> = [];
  const lockfiles = await findUvLockfiles();
  if (!lockfiles.length) return out;
  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    // Only consider importers under apps/* or libs/* per repo convention
    if (!/^(apps|libs)\//.test(relLf)) continue;
    const importerLabel = path.dirname(relLf) || ".";
    const name = providerNameForImporter(relLf, importerLabel);
    out.push({ provider: name, key: `lockfile:${relLf}#${importerLabel}` });
  }
  // Deterministic ordering
  out.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  return out;
}
