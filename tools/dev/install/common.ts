import * as fsp from "node:fs/promises";
import path from "node:path";

// Must mirror tools/nix/templates-common.nix sanitizeName
export function sanitizeName(input: string): string {
  return input.replace(/\/\/|:|\/|\s/g, "-");
}

export async function findNearestImporterLock(
  startCwd: string,
): Promise<{ importer: string; lockRel: string } | null> {
  let here = startCwd;
  const root = startCwd;
  while (true) {
    const cand = path.join(here, "pnpm-lock.yaml");
    const rel = path.relative(root, cand);
    const importer = path.dirname(rel);
    try {
      await fsp.access(cand);
      return { importer, lockRel: rel };
    } catch {}
    const next = path.dirname(here);
    if (next === here) break;
    here = next;
  }
  return null;
}

export function nodeModulesAttr(importer: string): string {
  return importer === "." ? "node-modules.default" : `node-modules.${sanitizeName(importer)}`;
}

export function pnpmStoreAttr(importer: string): string {
  return importer === "." ? "pnpm-store.default" : `pnpm-store.${sanitizeName(importer)}`;
}
