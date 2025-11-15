#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type FindLockfilesOptions = {
  roots?: string[];
  ignore?: string[];
};

const DEFAULT_IGNORES = new Set([
  ".git",
  "buck-out",
  "node_modules",
  ".pnpm-store",
  ".clinic",
  "coverage",
]);

function toPosixRelative(p: string): string {
  const rel = path.relative(process.cwd(), p) || ".";
  // Normalize to posix-style separators for determinism
  return rel.split(path.sep).join("/");
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
        out.add(toPosixRelative(full));
      }
    }
  }
}

export async function findPnpmLockfiles(opts?: FindLockfilesOptions): Promise<string[]> {
  const ignore = new Set<string>(opts?.ignore || []);
  for (const d of DEFAULT_IGNORES) ignore.add(d);
  const roots = (opts?.roots && opts.roots.length ? opts.roots : ["."])
    .map((r) => r.trim())
    .filter(Boolean);

  const found = new Set<string>();

  // Source 1: git-tracked lockfiles (when available)
  try {
    const { stdout, exitCode } = await $({
      stdio: "pipe",
    })`git ls-files '**/pnpm-lock.yaml'`.nothrow();
    if (exitCode === 0) {
      const candidates = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const lf of candidates) {
        // Filter ignores by path segment membership
        const segs = lf.split("/").filter(Boolean);
        if (segs.some((s) => ignore.has(s))) continue;
        if (await pathExists(lf)) found.add(toPosixRelative(path.resolve(lf)));
      }
    }
  } catch {
    // ignore
  }

  // Source 2: filesystem walk under roots
  for (const r of roots) {
    const abs = path.resolve(r);
    await walkForLockfiles(abs, ignore, found);
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}
