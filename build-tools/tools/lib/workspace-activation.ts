import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { VIBEROOTS_CURRENT_REL, VIBEROOTS_WORKSPACE_REL, resolveWorkspaceRootSync } from "./repo";

export type ActivationResult = {
  workspaceRoot: string;
  sourcePath: string;
  currentPath: string;
  currentTarget: string;
  workspaceDirs: string[];
};

type ActivationOptions = {
  start?: string;
  env?: NodeJS.ProcessEnv;
  sourcePath?: string;
  shellEntry?: boolean;
};

function flakeUsesLocalViberoots(workspaceRoot: string): boolean {
  try {
    const text = fs.readFileSync(path.join(workspaceRoot, "flake.nix"), "utf8");
    return /viberoots\.url\s*=\s*"path:\.\/viberoots"/.test(text);
  } catch {
    return false;
  }
}

function requireFile(filePath: string, message: string): void {
  if (!fs.existsSync(filePath)) throw new Error(message);
}

function relativeLinkTarget(fromDir: string, target: string): string {
  const rel = path.relative(fromDir, target) || ".";
  return rel.startsWith("..") ? rel : `./${rel}`;
}

function chooseSource(workspaceRoot: string, opts: ActivationOptions): string {
  if (opts.sourcePath) return path.resolve(workspaceRoot, opts.sourcePath);
  if (flakeUsesLocalViberoots(workspaceRoot)) return path.join(workspaceRoot, "viberoots");
  const envRoot = (opts.env?.VIBEROOTS_ROOT || "").trim();
  if (envRoot) return path.resolve(envRoot);
  return workspaceRoot;
}

function validateSource(workspaceRoot: string, sourcePath: string): void {
  if (sourcePath === workspaceRoot) return;
  requireFile(
    path.join(sourcePath, "flake.nix"),
    `viberoots activation source is missing flake.nix: ${sourcePath}`,
  );
}

function validateBuckconfigCells(workspaceRoot: string): void {
  const buckconfig = path.join(workspaceRoot, ".buckconfig");
  if (!fs.existsSync(buckconfig)) return;
  const text = fs.readFileSync(buckconfig, "utf8");
  const missing = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => line.includes(".viberoots/current"))
    .map((line) => line.split("=", 2)[1]?.trim() || "")
    .map((value) => path.resolve(workspaceRoot, value))
    .filter((candidate) => !fs.existsSync(candidate));
  if (missing.length > 0) {
    throw new Error(`.buckconfig references missing viberoots cell path: ${missing[0]}`);
  }
}

async function replaceCurrentSymlink(currentPath: string, target: string): Promise<void> {
  try {
    const stat = await fsp.lstat(currentPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`${currentPath} exists and is not a symlink`);
    }
    await fsp.unlink(currentPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await fsp.symlink(target, currentPath);
}

async function rejectStaleLocalCurrent(currentPath: string, sourcePath: string): Promise<void> {
  try {
    const stat = await fsp.lstat(currentPath);
    if (!stat.isSymbolicLink()) throw new Error(`${currentPath} exists and is not a symlink`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const sourceReal = await fsp.realpath(sourcePath);
  let currentReal = "";
  try {
    currentReal = await fsp.realpath(currentPath);
  } catch {
    const target = await fsp.readlink(currentPath);
    throw new Error(`${currentPath} points at ${target}; expected local viberoots ${sourceReal}`);
  }
  if (currentReal !== sourceReal) {
    throw new Error(
      `${currentPath} points at ${currentReal}; expected local viberoots ${sourceReal}`,
    );
  }
}

export async function activateWorkspace(opts: ActivationOptions = {}): Promise<ActivationResult> {
  const env = opts.env || process.env;
  const workspaceRoot = resolveWorkspaceRootSync(opts.start || process.cwd(), env);
  requireFile(path.join(workspaceRoot, ".buckroot"), "viberoots activation requires .buckroot");

  const sourcePath = chooseSource(workspaceRoot, { ...opts, env });
  validateSource(workspaceRoot, sourcePath);

  const viberootsDir = path.join(workspaceRoot, ".viberoots");
  const currentPath = path.join(workspaceRoot, VIBEROOTS_CURRENT_REL);
  const currentTarget =
    sourcePath === path.join(workspaceRoot, "viberoots")
      ? "../viberoots"
      : relativeLinkTarget(viberootsDir, sourcePath);
  const sourceIsLocalViberoots = sourcePath === path.join(workspaceRoot, "viberoots");
  const workspaceDirs = opts.shellEntry
    ? [path.join(workspaceRoot, ".viberoots", "cache")]
    : [
        path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL),
        path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL, "providers"),
        path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL, "buck"),
        path.join(workspaceRoot, ".viberoots", "cache"),
      ];

  await fsp.mkdir(viberootsDir, { recursive: true });
  for (const dir of workspaceDirs) await fsp.mkdir(dir, { recursive: true });
  if (sourceIsLocalViberoots) await rejectStaleLocalCurrent(currentPath, sourcePath);
  await replaceCurrentSymlink(currentPath, currentTarget);
  validateBuckconfigCells(workspaceRoot);

  return { workspaceRoot, sourcePath, currentPath, currentTarget, workspaceDirs };
}
