#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { decodeFromPatchFilename, providerNameForModuleKey } from "../../lib/providers";
import { writeIfChanged } from "../../lib/fs-helpers";

export type GoEntry = { provider: string; moduleKey: string; patchPath: string };

function decodeModuleKeyFromFilename(file: string): string | null {
  if (!file.endsWith(".patch")) return null;
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) return null;
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) return null;
  const importPath = decodeFromPatchFilename(enc);
  return `${importPath}@${ver}`.toLowerCase();
}

export async function readGoEntries(opts?: {
  patchDir?: string;
  strict?: boolean;
}): Promise<GoEntry[]> {
  const PATCH_DIR = opts?.patchDir || "patches/go";
  const STRICT = !!opts?.strict;
  const entries: GoEntry[] = [];
  if (!(await fs.pathExists(PATCH_DIR))) return entries;
  const byModuleKey = new Map<string, string>(); // moduleKey -> filename
  const seenProvider = new Map<string, string>(); // provider -> moduleKey
  const list = await fs.readdir(PATCH_DIR, { withFileTypes: true });
  for (const e of list) {
    if (e.isDirectory()) {
      const msg = `[go] ignoring subdirectory ${e.name}`;
      if (STRICT) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    const key = decodeModuleKeyFromFilename(e.name);
    if (!key) {
      const msg = `[go] invalid or non-patch file in patches/go: ${e.name}`;
      if (STRICT) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    const prev = byModuleKey.get(key);
    if (prev && prev !== e.name) {
      throw new Error(`Duplicate patch for ${key}: ${prev} vs ${e.name}`);
    }
    byModuleKey.set(key, e.name);
    const at = key.lastIndexOf("@");
    const imp = key.slice(0, at);
    const ver = key.slice(at + 1);
    const provider = providerNameForModuleKey(imp, ver);
    const priorForProvider = seenProvider.get(provider);
    if (priorForProvider && priorForProvider !== key) {
      throw new Error(`Provider name collision: ${provider}\n${priorForProvider} vs ${key}`);
    }
    seenProvider.set(provider, key);
    entries.push({ provider, moduleKey: key, patchPath: path.join(PATCH_DIR, e.name) });
  }
  entries.sort((a, b) => a.provider.localeCompare(b.provider));
  return entries;
}

export function renderGoTargets(entries: GoEntry[], opts?: { patchDir?: string }): string {
  const PATCH_DIR = opts?.patchDir || "patches/go";
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    `# Providers derived from filenames in ${PATCH_DIR}.`,
    "",
    'load("//third_party/providers:defs.bzl", "go_module_patch")',
    "",
  ].join("\n");
  const body = entries
    .map(
      (e) =>
        `go_module_patch(name = "${e.provider}", module_key = "${e.moduleKey}", patch_path = "${e.patchPath}",)`,
    )
    .join("\n");
  return header + body + (body ? "\n" : "");
}

export async function syncGoProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const out = opts?.outFile || "third_party/providers/TARGETS.auto";
  const entries = await readGoEntries({ patchDir: opts?.patchDir, strict: opts?.strict });
  const txt = renderGoTargets(entries, { patchDir: opts?.patchDir });
  await writeIfChanged(out, txt);
}
