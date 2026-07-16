#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveWorkspaceRootSync, VIBEROOTS_WORKSPACE_REL } from "./workspace-roots";

export {
  resolveProjectScanContext,
  resolveWorkspaceRootsSync,
  resolveWorkspaceRootSync,
  VIBEROOTS_CURRENT_REL,
  VIBEROOTS_WORKSPACE_REL,
} from "./workspace-roots";
export type {
  ProjectScanContext,
  ViberootsCurrentStatus,
  ViberootsSourceMode,
  WorkspaceRoots,
} from "./workspace-roots";

const execFileAsync = promisify(execFile);

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start: string): Promise<string> {
  const explicitWorkspaceRoot = (process.env.WORKSPACE_ROOT || "").trim();
  if (explicitWorkspaceRoot) {
    const explicitRoot = path.resolve(explicitWorkspaceRoot);
    const startAbs = path.resolve(start);
    const startsInsideExplicitRoot =
      startAbs === explicitRoot || startAbs.startsWith(`${explicitRoot}${path.sep}`);
    if (
      startsInsideExplicitRoot &&
      ((await pathExists(path.join(explicitRoot, "flake.nix"))) ||
        (await pathExists(path.join(explicitRoot, VIBEROOTS_WORKSPACE_REL, "flake.nix"))))
    ) {
      return explicitRoot;
    }
  }
  const candidates = [
    start,
    explicitWorkspaceRoot,
    (process.env._VIBEROOTS_DEVSHELL_ROOT || "").trim(),
    (process.env.LIVE_ROOT || "").trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    let dir = path.resolve(candidate);
    for (;;) {
      const parent = path.dirname(dir);
      if (
        path.basename(dir) === "workspace" &&
        path.basename(parent) === ".viberoots" &&
        (await pathExists(path.join(dir, "flake.nix")))
      ) {
        return path.dirname(parent);
      }
      if (
        path.basename(dir) === "viberoots" &&
        (await pathExists(path.join(parent, VIBEROOTS_WORKSPACE_REL, "flake.nix")))
      ) {
        return parent;
      }
      if (await pathExists(path.join(dir, VIBEROOTS_WORKSPACE_REL, "flake.nix"))) return dir;
      if (await pathExists(path.join(dir, "flake.nix"))) return dir;
      if (parent === dir) break;
      dir = parent;
    }
  }
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      candidates[0] || start,
      "rev-parse",
      "--show-toplevel",
    ]);
    const p = String(stdout || "").trim();
    if (p) return p;
  } catch {}
  return path.resolve(candidates[0] || start);
}

// Lightweight, synchronous repo root resolver used by zx scripts and helpers.
// Prefers the invocation directory so stale shell anchors cannot override cwd.
export function repoRoot(): string {
  return resolveWorkspaceRootSync();
}
