#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { findPnpmLockfiles, findUvLockfiles } from "./lockfiles.ts";

function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "") || ".";
}

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
