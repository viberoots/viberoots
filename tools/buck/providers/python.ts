#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { renderTargetsFile, writeIfChanged, maybeAssumeUnchanged } from "../../lib/fs-helpers.ts";
import { scanFlatPatchDir } from "../../lib/provider-sync.ts";
import { providerNameForImporter, decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { ensureAutoSection } from "../../lib/auto-section.ts";
import { findUvLockfiles } from "../../lib/lockfiles.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";

export async function syncPythonProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const PATCH_DIR = opts?.patchDir || "patches/python";
  const OUT_FILE = opts?.outFile || "third_party/providers/TARGETS.python.auto";
  const STRICT = opts?.strict ?? false;

  const lockfiles = await findUvLockfiles();

  // Empty state: still ensure deterministic, header-only file exists
  if (!lockfiles.length) {
    const header = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
      "",
      "",
    ].join("\n");
    await writeIfChanged(OUT_FILE, renderTargetsFile(header, []));
    return;
  }

  // Scan the flat global patches directory once and build a lookup
  const scanned = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    strict: STRICT,
    decodeKey: decodeNameVersionFromPatch,
    nameForKey: (k) => k, // stable ordering by canonical key
  });
  const keyToPatchPath = new Map<string, string>();
  for (const e of scanned) keyToPatchPath.set(e.key, e.patchPath);

  const seenNames = new Map<string, string>(); // provider name -> unique key lockfile#importer
  const entries: string[] = [];

  for (const lf of lockfiles) {
    const relLf = lf.replace(/^\.\/+/, "");
    // Only generate providers for known importers under apps/* or libs/*
    if (!/^(apps|libs)\//.test(relLf)) continue;
    const importerLabel = path.dirname(relLf) || ".";

    // Parse uv.lock for "<name>@<version>" effective set
    let eff: Set<string> = new Set();
    try {
      eff = await parseUvLockKeys(lf);
    } catch (e) {
      // Be strict only when requested; otherwise, treat as empty
      if (STRICT) throw e;
      eff = new Set();
    }
    const usedPatches = Array.from(eff)
      .map((k) => keyToPatchPath.get(k) || "")
      .filter(Boolean)
      .sort();

    const name = providerNameForImporter(relLf, importerLabel);
    const key = `${relLf}#${importerLabel}`;
    const prev = seenNames.get(name);
    if (prev) {
      if (prev !== key) {
        throw new Error(`Provider name collision: ${name}\n${prev} vs ${key}`);
      } else {
        continue; // exact duplicate, skip
      }
    }
    seenNames.set(name, key);
    entries.push(
      `python_importer_deps(name="${name}", lockfile="${relLf}", importer="${importerLabel}", patch_paths=[${usedPatches
        .map((s) => `"${s}"`)
        .join(", ")}])`,
    );
  }

  // Sort entries for deterministic output
  entries.sort();

  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
    "",
    "",
  ].join("\n");
  await writeIfChanged(OUT_FILE, renderTargetsFile(header, entries));
  // Avoid accidental commits: mark generated provider TARGETS file as assume-unchanged if tracked
  await maybeAssumeUnchanged(OUT_FILE);

  // Also synchronize an auto-managed section inside third_party/providers/TARGETS for Buck resolution.
  if (OUT_FILE !== "third_party/providers/TARGETS") {
    try {
      await ensureAutoSection({
        file: "third_party/providers/TARGETS",
        begin: "# BEGIN AUTO_PYTHON",
        end: "# END AUTO_PYTHON",
        header: 'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
        body: renderTargetsFile("", entries).trim(),
      });
      await maybeAssumeUnchanged("third_party/providers/TARGETS");
    } catch {}
  }
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
