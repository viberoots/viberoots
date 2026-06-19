#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VIBEROOTS_CURRENT_REL = ".viberoots/current";
export const VIBEROOTS_WORKSPACE_REL = ".viberoots/workspace";

export type ViberootsSourceMode = "local" | "remote";
export type ViberootsCurrentStatus = "present" | "missing";

export type WorkspaceRoots = {
  workspaceRoot: string;
  viberootsRoot: string;
  viberootsCurrent: string;
  viberootsWorkspace: string;
  sourceMode: ViberootsSourceMode;
  currentStatus: ViberootsCurrentStatus;
  currentPointsToLiveCheckout: boolean;
};

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start: string): Promise<string> {
  const candidates = [
    (process.env.WORKSPACE_ROOT || "").trim(),
    (process.env._VIBEROOTS_DEVSHELL_ROOT || "").trim(),
    (process.env.LIVE_ROOT || "").trim(),
    start,
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

function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function findFlakeRootSync(start: string): string | null {
  let dir = canonicalPath(start);
  for (;;) {
    const parent = path.dirname(dir);
    if (
      path.basename(dir) === "workspace" &&
      path.basename(parent) === ".viberoots" &&
      fs.existsSync(path.join(dir, "flake.nix"))
    ) {
      return path.dirname(parent);
    }
    if (
      path.basename(dir) === "viberoots" &&
      fs.existsSync(path.join(parent, VIBEROOTS_WORKSPACE_REL, "flake.nix"))
    ) {
      return parent;
    }
    if (fs.existsSync(path.join(dir, VIBEROOTS_WORKSPACE_REL, "flake.nix"))) return dir;
    if (fs.existsSync(path.join(dir, "flake.nix"))) return dir;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveWorkspaceRootSync(
  start: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    (env.WORKSPACE_ROOT || "").trim(),
    (env._VIBEROOTS_DEVSHELL_ROOT || "").trim(),
    (env.BUCK_TEST_SRC || "").trim(),
    (env.LIVE_ROOT || "").trim(),
    start,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = findFlakeRootSync(candidate);
    if (root) return root;
  }
  return canonicalPath(candidates[0] || start);
}

function isNixStorePath(p: string): boolean {
  return canonicalPath(p).includes(`${path.sep}nix${path.sep}store${path.sep}`);
}

export function resolveWorkspaceRootsSync(opts?: {
  start?: string;
  env?: NodeJS.ProcessEnv;
}): WorkspaceRoots {
  const env = opts?.env || process.env;
  const workspaceRoot = resolveWorkspaceRootSync(opts?.start || process.cwd(), env);
  const viberootsCurrent = path.join(workspaceRoot, VIBEROOTS_CURRENT_REL);
  const viberootsWorkspace = path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL);
  const envRoot = (env.VIBEROOTS_ROOT || "").trim();
  const currentExists = fs.existsSync(viberootsCurrent);
  const viberootsRoot = envRoot
    ? canonicalPath(envRoot)
    : currentExists
      ? canonicalPath(viberootsCurrent)
      : workspaceRoot;
  const nestedLiveCheckout = path.join(workspaceRoot, "viberoots");
  const liveCheckouts = [workspaceRoot, nestedLiveCheckout].filter((p) => fs.existsSync(p));
  const currentPointsToLiveCheckout =
    currentExists &&
    liveCheckouts.some(
      (liveCheckout) => canonicalPath(viberootsCurrent) === canonicalPath(liveCheckout),
    );

  return {
    workspaceRoot,
    viberootsRoot,
    viberootsCurrent,
    viberootsWorkspace,
    sourceMode: isNixStorePath(viberootsRoot) ? "remote" : "local",
    currentStatus: currentExists ? "present" : "missing",
    currentPointsToLiveCheckout,
  };
}

// Lightweight, synchronous repo root resolver used by zx scripts and helpers.
// Prefers explicit environment anchors to avoid accidental cwd drift in tests/CI.
export function repoRoot(): string {
  return resolveWorkspaceRootSync();
}
