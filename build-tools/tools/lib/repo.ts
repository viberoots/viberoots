#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start: string): Promise<string> {
  let dir = path.resolve(start);
  for (;;) {
    if (await pathExists(path.join(dir, "flake.nix"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const { stdout } = await $({
      stdio: "pipe",
    })`git -C ${start} rev-parse --show-toplevel`.nothrow();
    const p = String(stdout || "").trim();
    if (p) return p;
  } catch {}
  return path.resolve(start);
}

// Lightweight, synchronous repo root resolver used by zx scripts and helpers.
// Prefers explicit environment anchors to avoid accidental cwd drift in tests/CI.
export function repoRoot(): string {
  const canonical = (p: string): string => {
    const abs = path.resolve(p);
    try {
      return fs.realpathSync.native(abs);
    } catch {
      return abs;
    }
  };
  const candidates = [
    (process.env.WORKSPACE_ROOT || "").trim(),
    (process.env.LIVE_ROOT || "").trim(),
    process.cwd(),
  ].filter(Boolean);
  const findFlakeRoot = (start: string): string | null => {
    let dir = canonical(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, "flake.nix"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  for (const c of candidates) {
    const root = findFlakeRoot(c);
    if (root) return root;
  }
  return canonical(candidates[0] || process.cwd());
}
