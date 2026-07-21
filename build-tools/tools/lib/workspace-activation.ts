import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";
import { VIBEROOTS_CURRENT_REL, VIBEROOTS_WORKSPACE_REL, resolveWorkspaceRootSync } from "./repo";
import { remoteSourcePath } from "./workspace-remote-source";
import { inferBootstrapConsumerModeSync } from "./consumer-source-mode-detect";

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

function requireFile(filePath: string, message: string): void {
  if (!fs.existsSync(filePath)) throw new Error(message);
}

function relativeLinkTarget(fromDir: string, target: string): string {
  if (target.startsWith(`${path.sep}nix${path.sep}store${path.sep}`)) return target;
  const rel = path.relative(fromDir, target) || ".";
  return rel.startsWith("..") ? target : `./${rel}`;
}

function isNixStoreLinkTarget(target: string): boolean {
  return target.startsWith(`${path.sep}nix${path.sep}store${path.sep}`);
}

function isGeneratedRemoteSourceLinkTarget(target: string): boolean {
  return isNixStoreLinkTarget(target) || path.basename(target).startsWith("nix-store-vbr-source-");
}

function chooseSource(workspaceRoot: string, opts: ActivationOptions): string {
  if (opts.sourcePath) return path.resolve(workspaceRoot, opts.sourcePath);
  if (inferBootstrapConsumerModeSync(workspaceRoot) === "submodule") {
    return path.join(workspaceRoot, "viberoots");
  }
  const remotePath = remoteSourcePath(workspaceRoot);
  if (remotePath) return remotePath;
  const envRoot = (opts.env?.VIBEROOTS_ROOT || "").trim();
  if (envRoot) return path.resolve(envRoot);
  return workspaceRoot;
}

function localSourceHasExtractedToolTree(workspaceRoot: string, sourcePath: string): boolean {
  const hasExtractedCells = (root: string): boolean => {
    return (
      fs.existsSync(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")) &&
      fs.existsSync(path.join(root, "prelude")) &&
      fs.existsSync(path.join(root, "toolchains"))
    );
  };
  if (fs.existsSync(path.join(sourcePath, "build-tools", "tools", "dev", "zx-init.mjs"))) {
    return true;
  }
  try {
    const flakeText = fs.readFileSync(path.join(sourcePath, "flake.nix"), "utf8");
    if (
      flakeText.includes("viberoots local dogfood flake") &&
      flakeText.includes("import ./build-tools/tools/nix/flake/outputs.nix") &&
      !hasExtractedCells(sourcePath)
    ) {
      return false;
    }
  } catch {}
  const buildToolsPath = path.join(sourcePath, "build-tools");
  try {
    const stat = fs.lstatSync(buildToolsPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function validateSource(workspaceRoot: string, sourcePath: string): void {
  if (sourcePath === workspaceRoot) return;
  requireFile(
    path.join(sourcePath, "flake.nix"),
    `viberoots activation source is missing flake.nix: ${sourcePath}`,
  );
}

function validateBuckconfigCells(
  workspaceRoot: string,
  opts: { allowMissingPrelude?: boolean } = {},
): void {
  const buckconfig = path.join(workspaceRoot, ".buckconfig");
  if (!fs.existsSync(buckconfig)) return;
  const text = fs.readFileSync(buckconfig, "utf8");
  const missing = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => line.includes(".viberoots/current"))
    .map((line) => line.split("=", 2)[1]?.trim() || "")
    .filter((value) => !(opts.allowMissingPrelude && value.includes(".viberoots/current/prelude")))
    .map((value) => path.resolve(workspaceRoot, value))
    .filter((candidate) => !fs.existsSync(candidate));
  if (missing.length > 0) {
    throw new Error(`.buckconfig references missing viberoots cell path: ${missing[0]}`);
  }
}

async function replaceCurrentSymlink(currentPath: string, target: string): Promise<void> {
  const targetAbs = path.resolve(path.dirname(currentPath), target);
  const currentMatchesTarget = async (): Promise<boolean> => {
    try {
      const stat = await fsp.lstat(currentPath);
      if (!stat.isSymbolicLink()) return false;
      if ((await fsp.readlink(currentPath)) === target) return true;
      return (await fsp.realpath(currentPath)) === (await fsp.realpath(targetAbs));
    } catch {
      return false;
    }
  };
  if (await currentMatchesTarget()) return;
  try {
    const stat = await fsp.lstat(currentPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`${currentPath} exists and is not a symlink`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const tmpPath = path.join(
    path.dirname(currentPath),
    `.current-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await fsp.symlink(target, tmpPath);
    await fsp.rename(tmpPath, currentPath);
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}

async function ensureWorkspaceBuckStateLink(workspaceRoot: string): Promise<void> {
  const realDir = path.join(workspaceRoot, ".viberoots", "buck");
  const linkPath = path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL, "buck");
  const linkTarget = "../buck";
  await mkdirWithMacosMetadataExclusion(realDir);
  await mkdirWithMacosMetadataExclusion(path.dirname(linkPath));

  const migrateEntry = async (source: string, destination: string): Promise<void> => {
    const sourceStat = await fsp.lstat(source);
    const destinationStat = await fsp.lstat(destination).catch(() => null);
    if (!destinationStat) {
      await fsp.rename(source, destination);
      return;
    }
    if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
      for (const name of await fsp.readdir(source)) {
        await migrateEntry(path.join(source, name), path.join(destination, name));
      }
      await fsp.rmdir(source);
      return;
    }
    if (sourceStat.isFile() && destinationStat.isFile()) {
      const [sourceBytes, destinationBytes] = await Promise.all([
        fsp.readFile(source),
        fsp.readFile(destination),
      ]);
      if (sourceBytes.equals(destinationBytes)) {
        await fsp.unlink(source);
        return;
      }
    }
    if (sourceStat.isSymbolicLink() && destinationStat.isSymbolicLink()) {
      const [sourceTarget, destinationTarget] = await Promise.all([
        fsp.readlink(source),
        fsp.readlink(destination),
      ]);
      if (sourceTarget === destinationTarget) {
        await fsp.unlink(source);
        return;
      }
    }
    throw new Error(
      `workspace Buck state migration refuses to overwrite conflicting path: ${destination}`,
    );
  };

  try {
    const stat = await fsp.lstat(linkPath);
    if (stat.isSymbolicLink()) {
      if ((await fsp.readlink(linkPath)) === linkTarget) return;
      await fsp.unlink(linkPath);
    } else {
      if (!stat.isDirectory()) {
        throw new Error(`workspace Buck state path is not a directory: ${linkPath}`);
      }
      for (const name of await fsp.readdir(linkPath)) {
        await migrateEntry(path.join(linkPath, name), path.join(realDir, name));
      }
      await fsp.rmdir(linkPath);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  try {
    await fsp.symlink(linkTarget, linkPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const stat = await fsp.lstat(linkPath);
    if (!stat.isSymbolicLink() || (await fsp.readlink(linkPath)) !== linkTarget) throw e;
  }
}

async function removeNestedWorkspaceActivationState(workspaceRoot: string): Promise<void> {
  await fsp.rm(path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL, ".viberoots"), {
    recursive: true,
    force: true,
  });
}

async function rejectStaleLocalCurrent(
  currentPath: string,
  sourcePath: string,
  workspaceRoot: string,
  expectedTarget: string,
): Promise<void> {
  try {
    const stat = await fsp.lstat(currentPath);
    if (!stat.isSymbolicLink()) throw new Error(`${currentPath} exists and is not a symlink`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const sourceReal = await fsp.realpath(sourcePath);
  const expectedReal = expectedTarget === ".." ? workspaceRoot : sourceReal;
  const currentTarget = await fsp.readlink(currentPath);
  const currentTargetAbs = path.resolve(path.dirname(currentPath), currentTarget);
  if (isGeneratedRemoteSourceLinkTarget(currentTargetAbs)) return;
  let currentReal = "";
  try {
    currentReal = await fsp.realpath(currentPath);
  } catch {
    if (currentTarget === expectedTarget) return;
    throw new Error(
      `${currentPath} points at ${currentTarget}; expected local viberoots ${sourceReal}`,
    );
  }
  if (currentReal !== expectedReal) {
    throw new Error(
      `${currentPath} points at ${currentReal}; expected local viberoots ${expectedReal}`,
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
  const sourceIsLocalViberoots = sourcePath === path.join(workspaceRoot, "viberoots");
  const currentTarget =
    sourceIsLocalViberoots && !localSourceHasExtractedToolTree(workspaceRoot, sourcePath)
      ? ".."
      : sourceIsLocalViberoots
        ? "../viberoots"
        : relativeLinkTarget(viberootsDir, sourcePath);
  const workspaceDirs = opts.shellEntry
    ? [path.join(workspaceRoot, ".viberoots", "cache")]
    : [
        path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL),
        path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL, "providers"),
        path.join(workspaceRoot, ".viberoots", "buck"),
        path.join(workspaceRoot, ".viberoots", "cache"),
      ];

  await mkdirWithMacosMetadataExclusion(viberootsDir);
  for (const dir of workspaceDirs) await mkdirWithMacosMetadataExclusion(dir);
  if (!opts.shellEntry) {
    await ensureWorkspaceBuckStateLink(workspaceRoot);
    await removeNestedWorkspaceActivationState(workspaceRoot);
  }
  if (sourceIsLocalViberoots) {
    await rejectStaleLocalCurrent(currentPath, sourcePath, workspaceRoot, currentTarget);
  }
  await replaceCurrentSymlink(currentPath, currentTarget);
  validateBuckconfigCells(workspaceRoot, { allowMissingPrelude: opts.shellEntry });

  return { workspaceRoot, sourcePath, currentPath, currentTarget, workspaceDirs };
}
