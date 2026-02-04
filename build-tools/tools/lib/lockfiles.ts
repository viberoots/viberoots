#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  LOCKFILE_BASENAMES_BY_LANG,
  defaultLockfileBasenameForLang,
  lockfileBasenamesForLang,
} from "./lockfile-contracts.ts";

export { LOCKFILE_BASENAMES_BY_LANG, defaultLockfileBasenameForLang, lockfileBasenamesForLang };

const PNPM_LOCKFILE = defaultLockfileBasenameForLang("node");
const UV_LOCKFILE = defaultLockfileBasenameForLang("python");

function repoRoot(): string {
  // Prefer explicit roots when provided (keeps behavior stable in tests and CI)
  return (
    (process.env.WORKSPACE_ROOT && path.resolve(process.env.WORKSPACE_ROOT)) ||
    (process.env.LIVE_ROOT && path.resolve(process.env.LIVE_ROOT)) ||
    path.resolve(process.cwd())
  );
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
  const startCwdAbs = path.isAbsolute(cwd || "") ? (cwd as string) : path.resolve(root, cwd || ".");

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
      } else if (name === PNPM_LOCKFILE) {
        out.add(toPosixRelativeFrom(baseRoot, full));
      }
    }
  }
}

export async function findPnpmLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  const baseRoot = path.resolve(process.cwd());
  const rootsRel = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => (path.isAbsolute(r) ? r : path.resolve(baseRoot, r)))
    .map((r) => r.trim())
    .filter(Boolean);
  const rootPrefixes = rootsRel.map((abs) => {
    const rel = toPosixRelativeFrom(baseRoot, abs);
    return rel === "." ? "." : rel.replace(/\/+$/, "");
  });

  const found = new Set<string>();

  const useGitStage = !opts?.roots || opts.roots.length === 0;
  if (useGitStage) {
    try {
      const { stdout, exitCode } = await $({
        stdio: "pipe",
        cwd: baseRoot,
      })`git ls-files '**/${PNPM_LOCKFILE}'`.nothrow();
      if (exitCode === 0) {
        const candidates = String(stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const lfRel of candidates) {
          const segs = lfRel.split("/").filter(Boolean);
          if (segs.some((s) => ignore.has(s))) continue;
          const abs = path.resolve(baseRoot, lfRel);
          if (await pathExists(abs)) found.add(toPosixRelativeFrom(baseRoot, abs));
        }
      }
    } catch {
      // ignore
    }
  }

  for (const r of rootsRel) {
    const abs = path.resolve(r);
    await walkForLockfiles(abs, baseRoot, ignore, found);
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

export async function findUvLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  const baseRoot = path.resolve(process.cwd());
  const rootsRel = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => (path.isAbsolute(r) ? r : path.resolve(baseRoot, r)))
    .map((r) => r.trim())
    .filter(Boolean);

  const found = new Set<string>();

  const useGitStage = !opts?.roots || opts.roots.length === 0;
  if (useGitStage) {
    try {
      const { stdout, exitCode } = await $({
        stdio: "pipe",
        cwd: baseRoot,
      })`git ls-files '**/uv.lock'`.nothrow();
      if (exitCode === 0) {
        const candidates = String(stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const rel of candidates) {
          const segs = rel.split("/").filter(Boolean);
          if (segs.some((s) => ignore.has(s))) continue;
          const abs = path.resolve(baseRoot, rel);
          if (await pathExists(abs)) found.add(toPosixRelativeFrom(baseRoot, abs));
        }
      }
    } catch {
      // ignore
    }
  }

  async function walkUv(rootDir: string, baseRoot: string, ignore: Set<string>, out: Set<string>) {
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
        } else if (name === UV_LOCKFILE) {
          out.add(toPosixRelativeFrom(baseRoot, full));
        }
      }
    }
  }
  for (const r of rootsRel) {
    const abs = path.resolve(r);
    await walkUv(abs, baseRoot, ignore, found);
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}
