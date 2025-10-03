#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

export type ScanOpts = {
  patchDir: string; // e.g., patches/go
  strict?: boolean;
  decodeKey: (filename: string) => string | null; // derive module key from filename
  nameForKey: (key: string) => string; // stable provider name for dedupe
};

export type ProviderEntry = { provider: string; key: string; patchPath: string };

export async function scanFlatPatchDir(opts: ScanOpts): Promise<ProviderEntry[]> {
  const { patchDir, strict } = opts;
  const entries: ProviderEntry[] = [];
  if (!(await fs.pathExists(patchDir))) return entries;
  const byKey = new Map<string, string>();
  const seenProvider = new Map<string, string>();
  const list = await fs.readdir(patchDir, { withFileTypes: true });
  for (const e of list) {
    if (e.isDirectory()) {
      const msg = `ignoring subdirectory ${e.name}`;
      if (strict) throw new Error(msg);
      console.warn(`warning: ${msg}`);
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
    const provider = opts.nameForKey(key);
    const priorForProvider = seenProvider.get(provider);
    if (priorForProvider && priorForProvider !== key) {
      throw new Error(`Provider name collision: ${provider}\n${priorForProvider} vs ${key}`);
    }
    seenProvider.set(provider, key);
    entries.push({ provider, key, patchPath: path.join(patchDir, e.name) });
  }
  entries.sort((a, b) => a.provider.localeCompare(b.provider));
  return entries;
}
