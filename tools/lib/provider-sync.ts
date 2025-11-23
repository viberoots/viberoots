#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type ScanOpts = {
  patchDir: string; // e.g., patches/go
  strict?: boolean;
  decodeKey: (filename: string) => string | null; // derive module key from filename
  nameForKey?: (key: string) => string; // stable provider name for dedupe (optional)
  preDecodeFilter?: (filename: string) => boolean; // optional coarse filter before decode
};

export type ProviderEntry = { provider: string; key: string; patchPath: string };

export async function scanFlatPatchDir(opts: ScanOpts): Promise<ProviderEntry[]> {
  const { patchDir, strict } = opts;
  const entries: ProviderEntry[] = [];
  try {
    await fsp.access(patchDir);
  } catch {
    return entries;
  }
  const byKey = new Map<string, string>();
  const seenProvider = new Map<string, string>();
  const list = await fsp.readdir(patchDir, { withFileTypes: true } as any);
  for (const e of list) {
    if (e.isDirectory()) {
      const msg = `ignoring subdirectory ${e.name}`;
      if (strict) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    // Silently ignore dotfiles and common keepers; these are used to keep VCS directories
    // and should not trigger noisy warnings or strict failures.
    // This does not mask other invalid filenames; those continue to warn/fail below.
    if (e.name.startsWith(".") || e.name === ".gitkeep" || e.name === ".keep") {
      continue;
    }
    if (opts.preDecodeFilter && !opts.preDecodeFilter(e.name)) {
      // Skip early when not relevant to the caller’s selection strategy
      continue;
    }
    const key = opts.decodeKey(e.name);
    if (!key) {
      const msg = `invalid or non-patch file in ${patchDir}: ${e.name}`;
      if (strict) throw new Error(msg);
      console.warn(`warning: ${msg}`);
      continue;
    }
    const prev = byKey.get(key);
    if (prev && prev !== e.name) {
      throw new Error(`Duplicate patch for ${key}: ${prev} vs ${e.name}`);
    }
    byKey.set(key, e.name);
    const provider = opts.nameForKey ? opts.nameForKey(key) : "";
    if (opts.nameForKey) {
      const priorForProvider = seenProvider.get(provider);
      if (priorForProvider && priorForProvider !== key) {
        throw new Error(`Provider name collision: ${provider}\n${priorForProvider} vs ${key}`);
      }
      seenProvider.set(provider, key);
    }
    entries.push({ provider, key, patchPath: path.join(patchDir, e.name) });
  }
  entries.sort((a, b) => a.provider.localeCompare(b.provider));
  return entries;
}

// Lightweight validation that a patch directory is flat (no subdirectories).
// Used by languages that implement their own selection (e.g., C++) but want
// consistent warnings/errors about directory structure.
export async function validateFlatDir(patchDir: string, strict?: boolean) {
  try {
    await fsp.access(patchDir);
  } catch {
    return;
  }
  const list = await fsp.readdir(patchDir, { withFileTypes: true } as any);
  for (const e of list) {
    if (e.isDirectory()) {
      const msg = `ignoring subdirectory ${e.name}`;
      if (strict) throw new Error(msg);
      console.warn(`warning: ${msg}`);
    }
  }
}
