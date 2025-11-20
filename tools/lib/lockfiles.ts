#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

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
    await fsp.access(path.join(dir, "pnpm-lock.yaml"));
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

/**
 * Resolve the PNPM importer directory.
 * - If `flag` is provided, treat it as an explicit importer directory (absolute or repo-root-relative).
 * - Otherwise, walk upward from `cwd` until the nearest directory containing `pnpm-lock.yaml` within the repo root.
 * - Returns a normalized POSIX-style relative path from the repo root ('.' for repo root).
 */
export async function resolveImporterDir(cwd?: string, flag?: string): Promise<string> {
  const root = repoRoot();
  const startCwdAbs = path.isAbsolute(cwd || "") ? (cwd as string) : path.resolve(root, cwd || ".");

  // 1) Honor explicit flag when provided
  const raw = String(flag || "").trim();
  if (raw) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
    if (await hasPnpmLock(abs)) {
      return toPosixRel(root, abs);
    }
  }

  // 2) Walk upward from cwd to the repo root
  let cur = startCwdAbs;
  while (true) {
    if (await hasPnpmLock(cur)) return toPosixRel(root, cur);
    const next = path.dirname(cur);
    if (next === cur) break;
    // stop when leaving the repo root
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
      } else if (name === "pnpm-lock.yaml") {
        out.add(toPosixRelativeFrom(baseRoot, full));
      }
    }
  }
}

export async function findPnpmLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  // Anchor discovery to the caller's current working directory to cooperate with test sandboxes
  const baseRoot = path.resolve(process.cwd());
  const rootsRel = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => (path.isAbsolute(r) ? r : path.resolve(baseRoot, r)))
    .map((r) => r.trim())
    .filter(Boolean);
  // Track rel prefixes for filtering git results to requested roots
  const rootPrefixes = rootsRel.map((abs) => {
    const rel = toPosixRelativeFrom(baseRoot, abs);
    return rel === "." ? "." : rel.replace(/\/+$/, "");
  });

  const found = new Set<string>();

  // Source 1: git-tracked lockfiles (when available)
  const useGitStage = !opts?.roots || opts.roots.length === 0;
  if (useGitStage) {
    try {
      const { stdout, exitCode } = await $({
        stdio: "pipe",
        cwd: baseRoot,
      })`git ls-files '**/pnpm-lock.yaml'`.nothrow();
      if (exitCode === 0) {
        const candidates = String(stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const lfRel of candidates) {
          // Filter ignores by path segment membership
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

  // Source 2: filesystem walk under roots
  for (const r of rootsRel) {
    const abs = path.resolve(r);
    await walkForLockfiles(abs, baseRoot, ignore, found);
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

// Find uv.lock files under the repository, honoring default ignores and optional roots.
export async function findUvLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  const baseRoot = path.resolve(process.cwd());
  const rootsRel = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => (path.isAbsolute(r) ? r : path.resolve(baseRoot, r)))
    .map((r) => r.trim())
    .filter(Boolean);

  const found = new Set<string>();

  // Source 1: git-tracked uv.lock files
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

  // Source 2: filesystem walk
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
        } else if (name === "uv.lock") {
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
