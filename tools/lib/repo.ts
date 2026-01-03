#!/usr/bin/env zx-wrapper
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
  const a = (process.env.WORKSPACE_ROOT || "").trim();
  const b = (process.env.LIVE_ROOT || "").trim();
  const base = a || b || process.cwd();
  return path.resolve(base);
}
