#!/usr/bin/env zx-wrapper
import { scanFlatPatchDir } from "./provider-sync.ts";
import { toPosixPath, uniqSorted } from "./posix-path.ts";

export type ScanToKeyMapOpts = {
  patchDir: string;
  strict?: boolean;
  decodeKey: (filename: string) => string | null;
  preDecodeFilter?: (filename: string) => boolean;
};

export async function scanFlatPatchDirToLowercaseKeyToPatchPathMap(
  opts: ScanToKeyMapOpts,
): Promise<Map<string, string>> {
  const scanned = await scanFlatPatchDir({
    patchDir: opts.patchDir,
    strict: opts.strict,
    decodeKey: opts.decodeKey,
    nameForKey: (k) => k,
    preDecodeFilter: opts.preDecodeFilter,
  });

  const out = new Map<string, string>();
  for (const e of scanned) {
    out.set(String(e.key).toLowerCase(), toPosixPath(e.patchPath));
  }
  return out;
}

export function selectPatchPathsForEffectiveSet(opts: {
  effectiveSet: Iterable<string>;
  keyToPatchPath: Map<string, string>;
}): string[] {
  const selected: string[] = [];
  for (const raw of opts.effectiveSet) {
    const key = String(raw || "").toLowerCase();
    const p = opts.keyToPatchPath.get(key);
    if (p) selected.push(toPosixPath(p));
  }
  return uniqSorted(selected);
}
