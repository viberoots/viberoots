#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../../lib/fs-helpers";

type DirStamp = {
  rel: string;
  exists: boolean;
  mtimeMs: number;
};

type AbsenceStamp = {
  schema: 1;
  roots: string[];
  dirs: DirStamp[];
};

const DEFAULT_IGNORES = new Set([
  ".git",
  ".clinic",
  ".direnv",
  ".pnpm-store",
  ".viberoots",
  "buck-out",
  "coverage",
  "node_modules",
]);

function stampPath(repoRoot: string, name: string): string {
  return path.join(repoRoot, ".viberoots", "workspace", "install-cache", `${name}.json`);
}

function toRel(repoRoot: string, abs: string): string {
  const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
  return rel || ".";
}

async function statDir(abs: string): Promise<{ exists: boolean; mtimeMs: number }> {
  try {
    const st = await fsp.stat(abs);
    if (!st.isDirectory()) return { exists: false, mtimeMs: 0 };
    return { exists: true, mtimeMs: st.mtimeMs || 0 };
  } catch {
    return { exists: false, mtimeMs: 0 };
  }
}

export async function snapshotAbsenceDirs(
  repoRoot: string,
  roots: string[],
  opts?: { ignore?: Iterable<string> },
): Promise<DirStamp[]> {
  const ignore = new Set(DEFAULT_IGNORES);
  for (const name of opts?.ignore || []) ignore.add(name);
  const out = new Map<string, DirStamp>();
  const stack = roots.map((r) => path.resolve(repoRoot, r));
  while (stack.length) {
    const abs = stack.pop()!;
    const rel = toRel(repoRoot, abs);
    const st = await statDir(abs);
    out.set(rel, { rel, ...st });
    if (!st.exists) continue;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(abs);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (ignore.has(name)) continue;
      const child = path.join(abs, name);
      try {
        const childSt = await fsp.stat(child);
        if (childSt.isDirectory()) stack.push(child);
      } catch {}
    }
  }
  return Array.from(out.values()).sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function absenceCacheFresh(
  repoRoot: string,
  name: string,
  roots: string[],
): Promise<boolean> {
  let stamp: AbsenceStamp;
  try {
    stamp = JSON.parse(await fsp.readFile(stampPath(repoRoot, name), "utf8")) as AbsenceStamp;
  } catch {
    return false;
  }
  if (stamp.schema !== 1) return false;
  if (JSON.stringify(stamp.roots) !== JSON.stringify(roots)) return false;
  for (const prev of stamp.dirs) {
    const cur = await statDir(path.resolve(repoRoot, prev.rel));
    if (cur.exists !== prev.exists) return false;
    if (cur.mtimeMs !== prev.mtimeMs) return false;
  }
  return true;
}

export async function writeAbsenceCache(
  repoRoot: string,
  name: string,
  roots: string[],
): Promise<void> {
  const dst = stampPath(repoRoot, name);
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  const stamp: AbsenceStamp = {
    schema: 1,
    roots,
    dirs: await snapshotAbsenceDirs(repoRoot, roots),
  };
  await writeIfChanged(dst, `${JSON.stringify(stamp, null, 2)}\n`);
}
