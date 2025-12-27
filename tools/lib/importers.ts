#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { findPnpmLockfiles, findUvLockfiles } from "./lockfiles.ts";
import { toPosixPath } from "./posix-path.ts";

/**
 * Find importer lockfiles given simple filename globs.
 * Delegates to existing specialized scanners to preserve behavior and ignores.
 *
 * Supported filenames (used for routing):
 * - pnpm-lock.yaml  -> PNPM (Node)
 * - uv.lock         -> uv (Python)
 */
export async function findImporterLockfiles(globs: string[]): Promise<string[]> {
  const wantsPnpm = globs.some((g) => /pnpm-lock\.yaml$/.test(g));
  const wantsUv = globs.some((g) => /uv\.lock$/.test(g));
  const out = new Set<string>();
  if (wantsPnpm) {
    for (const lf of await findPnpmLockfiles()) out.add(toPosixPath(lf));
  }
  if (wantsUv) {
    for (const lf of await findUvLockfiles()) out.add(toPosixPath(lf));
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Compute the canonical importer label from a lockfile path.
 * Returns a POSIX-style relative path from repo root, with '.' for repo root.
 */
export function computeImporterLabel(lockfilePath: string): string {
  const rel = toPosixPath(lockfilePath);
  const dir = path.posix.dirname(rel);
  return dir === "" ? "." : dir;
}

/**
 * Return true when the importer path is a workspace path we support.
 * Current convention: only importers under apps/* or libs/*.
 * The input must be a POSIX-style relative path or '.'.
 */
export function isWorkspaceImporterPath(importer: string): boolean {
  const p = toPosixPath(importer);
  if (p === ".") return false;
  return /^(apps|libs)\/[^/]+$/.test(p);
}

/**
 * Return true when an importer label is supported for importer-scoped ecosystems.
 *
 * Supported importer labels:
 * - "."         (repo-root lockfile importers)
 * - "apps/*"    (workspace apps)
 * - "libs/*"    (workspace libs)
 *
 * Anything else is treated as unsupported and should not generate providers or auto-map entries.
 */
export function isSupportedImporterLabel(importer: string): boolean {
  const p = toPosixPath(importer);
  if (p === ".") return true;
  return /^(apps|libs)\/[^/]+$/.test(p);
}

/**
 * Compute the default importer-local patch directory (POSIX).
 * For importer '.', returns 'patches/<lang>'; otherwise '<importer>/patches/<lang>'.
 */
export function defaultImporterPatchDir(importer: string, lang: "node" | "python"): string {
  const imp = toPosixPath(importer);
  if (imp === ".") return path.posix.join("patches", lang);
  return path.posix.join(imp, "patches", lang);
}

/**
 * List importer-local patches (POSIX relative paths), deterministically sorted.
 * Missing directories are treated as empty. Only '*.patch' files are included.
 */
export async function listImporterPatches(
  importer: string,
  lang: "node" | "python",
): Promise<string[]> {
  const dirPosix = defaultImporterPatchDir(importer, lang);
  const abs = path.resolve(dirPosix);
  let names: string[] = [];
  try {
    names = await fsp.readdir(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    if (!n.endsWith(".patch")) continue;
    out.push(path.posix.join(dirPosix, n));
  }
  out.sort();
  return out;
}

/**
 * Discover PNPM lockfiles, plus "synthetic" lockfile paths for workspace importers that
 * have a package.json but do not yet have a pnpm-lock.yaml.
 *
 * This is an opt-in, Node-only policy used by provider sync to keep importer-scoped provider edges
 * stable during early scaffolding / partial adoption. By default, the provider sync contract is:
 * importer-scoped providers are generated only from real pnpm-lock.yaml files.
 *
 * The synthesized lockfile path does not claim that the lockfile exists or that any dependencies
 * are present; it only provides a deterministic key.
 *
 * Rules:
 * - Only workspace importers under apps/* or libs/* are eligible.
 * - An importer is eligible when <importer>/package.json exists.
 * - If <importer>/pnpm-lock.yaml already exists (discovered normally), it is not synthesized.
 * - Returned paths are POSIX-style repo-relative paths, deterministically sorted.
 */
export async function findPnpmLockfilesWithSyntheticWorkspaceImporters(): Promise<string[]> {
  const real = await findImporterLockfiles(["pnpm-lock.yaml"]);
  const out = new Set(real.map((p) => toPosixPath(p).replace(/^\.\/+/, "")));

  const rootAbs = (() => {
    const wr = String(process.env.WORKSPACE_ROOT || "").trim();
    return path.resolve(wr || process.cwd());
  })();

  const roots: Array<"apps" | "libs"> = ["apps", "libs"];
  for (const root of roots) {
    let children: string[] = [];
    try {
      children = await fsp.readdir(path.join(rootAbs, root));
    } catch {
      children = [];
    }
    for (const child of children) {
      const importer = toPosixPath(path.posix.join(root, child));
      if (!isWorkspaceImporterPath(importer)) continue;
      try {
        await fsp.access(path.join(rootAbs, importer, "package.json"));
      } catch {
        continue;
      }
      const lockRel = toPosixPath(path.posix.join(importer, "pnpm-lock.yaml"));
      if (!out.has(lockRel)) out.add(lockRel);
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the nearest uv.lock for a Buck package directory by walking upwards to repo root.
 *
 * - Input: package directory path, relative to repo root (POSIX or platform separators).
 * - Output: repo-relative POSIX lockfile path (e.g., "apps/api/uv.lock", or "uv.lock"), or null.
 *
 * This helper is intentionally shared between exporter and provider tooling to avoid drift.
 */
export async function findNearestUvLockForPackage(pkgDir: string): Promise<string | null> {
  const repoRoot = process.cwd();
  const start = path.resolve(repoRoot, pkgDir || ".");
  const root = path.resolve(repoRoot);
  const inside = (p: string) => p === root || p.startsWith(root + path.sep);

  let cur = start;
  while (inside(cur)) {
    const candidate = path.join(cur, "uv.lock");
    if (await pathExists(candidate)) {
      const rel = path.relative(repoRoot, candidate) || "uv.lock";
      return toPosixPath(rel);
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return null;
}

/**
 * Find the nearest pnpm-lock.yaml for a Buck package directory by walking upwards to repo root.
 *
 * - Input: package directory path, relative to repo root (POSIX or platform separators).
 * - Output: repo-relative POSIX lockfile path (e.g., "apps/web/pnpm-lock.yaml", or "pnpm-lock.yaml"), or null.
 *
 * This helper is intentionally shared between exporter and provider tooling to avoid drift.
 */
export async function findNearestPnpmLockForPackage(pkgDir: string): Promise<string | null> {
  const repoRoot = process.cwd();
  const start = path.resolve(repoRoot, pkgDir || ".");
  const root = path.resolve(repoRoot);
  const inside = (p: string) => p === root || p.startsWith(root + path.sep);

  let cur = start;
  while (inside(cur)) {
    const candidate = path.join(cur, "pnpm-lock.yaml");
    if (await pathExists(candidate)) {
      const rel = path.relative(repoRoot, candidate) || "pnpm-lock.yaml";
      return toPosixPath(rel);
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return null;
}
