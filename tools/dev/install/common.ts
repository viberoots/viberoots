import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveImporterDir } from "../../lib/lockfiles.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";
import { sanitizeName as sanitizeNameContract } from "../../lib/sanitize.ts";

// Must mirror tools/nix/templates-common.nix sanitizeName
export function sanitizeName(input: string): string {
  return sanitizeNameContract(input);
}

export function normalizeImporter(input: string | null | undefined): string {
  const raw = (input || "").trim();
  if (!raw) return ".";

  const { workspaceRoots } = getImporterRootsContract();
  const isSegment = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);

  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2 && workspaceRoots.includes(parts[0]) && isSegment(parts[1])) {
    return `${parts[0]}/${parts[1]}`;
  }

  // Best-effort extraction from longer paths (e.g. ".../apps/web/...")
  for (let i = 0; i + 1 < parts.length; i++) {
    const root = parts[i];
    const name = parts[i + 1];
    if (workspaceRoots.includes(root) && isSegment(name)) return `${root}/${name}`;
  }

  return ".";
}

export async function findNearestImporterLock(
  startCwd: string,
): Promise<{ importer: string; lockRel: string } | null> {
  try {
    const importer = await resolveImporterDir(startCwd);
    const lockRel = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
    return { importer, lockRel };
  } catch {
    return null;
  }
}

export function nodeModulesAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "node-modules.default" : `node-modules.${sanitizeName(imp)}`;
}

export function pnpmStoreAttr(importer: string): string {
  const imp = normalizeImporter(importer);
  return !imp || imp === "." ? "pnpm-store.default" : `pnpm-store.${sanitizeName(imp)}`;
}
