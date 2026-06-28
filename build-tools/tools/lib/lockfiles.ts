#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  LOCKFILE_BASENAMES_BY_LANG,
  defaultLockfileBasenameForLang,
  lockfileBasenamesForLang,
} from "./lockfile-contracts";

export { LOCKFILE_BASENAMES_BY_LANG, defaultLockfileBasenameForLang, lockfileBasenamesForLang };

const PNPM_LOCKFILE = defaultLockfileBasenameForLang("node");
const UV_LOCKFILE = defaultLockfileBasenameForLang("python");

function repoRoot(): string {
  const canonical = (p: string): string => {
    const abs = path.resolve(p);
    try {
      return fs.realpathSync.native(abs);
    } catch {
      return abs;
    }
  };
  // Prefer explicit roots when provided (keeps behavior stable in tests and CI),
  // but only when they actually point at a repo root.
  const candidates = [
    (process.env.WORKSPACE_ROOT || "").trim(),
    (process.env.LIVE_ROOT || "").trim(),
    process.cwd(),
  ].filter(Boolean);
  for (const c of candidates) {
    const root = canonical(c);
    if (fs.existsSync(path.join(root, "flake.nix"))) return root;
  }
  return canonical(candidates[0] || process.cwd());
}

async function hasPnpmLock(dir: string): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, PNPM_LOCKFILE));
    return true;
  } catch {
    return false;
  }
}

function toPosixRel(fromRootAbs: string, absDir: string): string {
  const rel = path.relative(fromRootAbs, absDir);
  const norm = rel.replace(/\\/g, "/");
  return norm === "" ? "." : norm;
}

export async function resolveImporterDir(cwd?: string, flag?: string): Promise<string> {
  const root = repoRoot();
  const startCwdAbsRaw = path.isAbsolute(cwd || "")
    ? (cwd as string)
    : path.resolve(root, cwd || ".");
  const startCwdAbs = (() => {
    try {
      return fs.realpathSync.native(startCwdAbsRaw);
    } catch {
      return path.resolve(startCwdAbsRaw);
    }
  })();

  const raw = String(flag || "").trim();
  if (raw) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
    if (await hasPnpmLock(abs)) {
      return toPosixRel(root, abs);
    }
  }

  let cur = startCwdAbs;
  while (true) {
    if (await hasPnpmLock(cur)) return toPosixRel(root, cur);
    const next = path.dirname(cur);
    if (next === cur) break;
    const relToRoot = path.relative(root, next);
    if (relToRoot.startsWith("..")) break;
    cur = next;
  }

  throw new Error(
    "cannot determine importer directory; run inside an importer or pass --importer <dir>",
  );
}

export type FindLockfilesOptions = {
  roots?: string[];
  ignore?: string[];
};

const DEFAULT_IGNORES = new Set<string>([
  ".git",
  "buck-out",
  "node_modules",
  ".pnpm-store",
  ".clinic",
  "coverage",
]);

function toPosixRelativeFrom(absBase: string, absPath: string): string {
  const rel = path.relative(absBase, absPath);
  return (rel || ".").replace(/\\/g, "/");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkForLockfiles(
  rootDir: string,
  baseRoot: string,
  ignore: Set<string>,
  basename: string,
  out: Set<string>,
): Promise<void> {
  const stack: string[] = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: any;
      try {
        st = await fsp.lstat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (ignore.has(name)) continue;
        stack.push(full);
      } else if (name === basename) {
        out.add(toPosixRelativeFrom(baseRoot, full));
      }
    }
  }
}

async function collectTrackedLockfiles(
  baseRoot: string,
  ignore: Set<string>,
  basename: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { stdout, exitCode } = await $({
      stdio: "pipe",
      cwd: baseRoot,
    })`git ls-files '**/${basename}'`
      .nothrow()
      .quiet();
    if (exitCode !== 0) return out;
    const candidates = String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const rel of candidates) {
      const segs = rel.split("/").filter(Boolean);
      if (segs.some((s) => ignore.has(s))) continue;
      const abs = path.resolve(baseRoot, rel);
      if (await pathExists(abs)) out.add(toPosixRelativeFrom(baseRoot, abs));
    }
  } catch {}
  return out;
}

async function findLockfilesByBasename(
  basename: string,
  opts?: FindLockfilesOptions,
): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  const baseRoot = path.resolve(process.cwd());
  const rootsAbs = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => (path.isAbsolute(r) ? r : path.resolve(baseRoot, r)))
    .map((r) => r.trim())
    .filter(Boolean);
  const found = new Set<string>();
  const useGitStage = !opts?.roots || opts.roots.length === 0;
  if (useGitStage) {
    const tracked = await collectTrackedLockfiles(baseRoot, ignore, basename);
    for (const p of tracked) found.add(p);
  }
  for (const r of rootsAbs) {
    await walkForLockfiles(r, baseRoot, ignore, basename, found);
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

export async function findPnpmLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  return await findLockfilesByBasename(PNPM_LOCKFILE, opts);
}

export async function findUvLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  return await findLockfilesByBasename(UV_LOCKFILE, opts);
}
