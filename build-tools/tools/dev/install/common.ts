import { getImporterRootsContract } from "../../lib/importer-roots.ts";
import { resolveImporterDir } from "../../lib/lockfiles.ts";
import { sanitizeName as sanitizeNameContract } from "../../lib/sanitize.ts";
import path from "node:path";

// Must mirror build-tools/tools/nix/templates-common.nix sanitizeName
export function sanitizeName(input: string): string {
  return sanitizeNameContract(input);
}

export function normalizeImporter(input: string | null | undefined): string {
  const raw = (input || "").trim();
  if (!raw) return ".";

  const { workspaceRoots } = getImporterRootsContract();
  const isSegment = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  const rootPartsList = workspaceRoots
    .map((root) => root.split("/").filter(Boolean))
    .filter((rootParts) => rootParts.length > 0);
  const matchAt = (startIdx: number, rootParts: string[]): string | null => {
    if (startIdx + rootParts.length >= parts.length) return null;
    for (let i = 0; i < rootParts.length; i++) {
      if (parts[startIdx + i] !== rootParts[i]) return null;
    }
    const name = parts[startIdx + rootParts.length];
    if (!isSegment(name)) return null;
    return `${rootParts.join("/")}/${name}`;
  };

  if (parts.length >= 2) {
    for (const rootParts of rootPartsList) {
      const match = matchAt(0, rootParts);
      if (match) return match;
    }
  }

  // Best-effort extraction from longer paths (e.g. ".../projects/apps/web/...")
  for (let i = 0; i + 1 < parts.length; i++) {
    for (const rootParts of rootPartsList) {
      const match = matchAt(i, rootParts);
      if (match) return match;
    }
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

export function flakeRefForImporter(repoOrWorkspaceRoot: string, importer: string): string {
  const root = path.resolve(repoOrWorkspaceRoot);
  const imp = normalizeImporter(importer);
  // Keep git-backed flake resolution for root importer to avoid expensive full path copies.
  // Use path: for non-root importers so freshly scaffolded/untracked importers are visible.
  return !imp || imp === "." ? root : `path:${root}`;
}
