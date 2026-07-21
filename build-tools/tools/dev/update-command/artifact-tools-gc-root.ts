import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { ensureNixStoreToolPathSync, envWithResolvedNixBin } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);

export function artifactToolsGcRootPath(repoRoot: string): string {
  return path.join(repoRoot, ".nix-gcroots", "artifact-tools");
}

export function artifactToolsCandidateGcRootPath(repoRoot: string): string {
  return path.join(repoRoot, ".nix-gcroots", ".artifact-tools.candidate");
}

export function artifactToolsGcRootArgs(gcRoot: string, storePath: string): string[] {
  return ["--add-root", gcRoot, "--indirect", "--realise", storePath];
}

async function rootTarget(gcRoot: string): Promise<string> {
  try {
    return await fsp.realpath(gcRoot);
  } catch {
    return "";
  }
}

async function assertOwnedRootPath(gcRoot: string): Promise<void> {
  const existing = await fsp.lstat(gcRoot).catch(() => null);
  if (existing && !existing.isSymbolicLink()) {
    throw new Error(`refusing to replace non-symlink artifact tools gc root: ${gcRoot}`);
  }
}

async function establishRoot(opts: {
  gcRoot: string;
  storePath: string;
  nixStore: string;
  repoRoot: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const result = await execFileAsync(
    opts.nixStore,
    artifactToolsGcRootArgs(opts.gcRoot, opts.storePath),
    {
      cwd: opts.repoRoot,
      env: opts.env,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const realized =
    String(result.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() || "";
  const rooted = await rootTarget(opts.gcRoot);
  if (![opts.storePath, opts.gcRoot].includes(realized) || rooted !== opts.storePath) {
    throw new Error(
      `failed to establish artifact tools gc root: expected ${opts.storePath}; realized ${realized || "(empty)"}; rooted ${rooted || "(missing)"}`,
    );
  }
}

export async function ensureArtifactToolsGcRoot(opts: {
  repoRoot: string;
  storePath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const gcRoot = artifactToolsGcRootPath(opts.repoRoot);
  if ((await rootTarget(gcRoot)) === opts.storePath) return gcRoot;

  const candidateRoot = artifactToolsCandidateGcRootPath(opts.repoRoot);
  await assertOwnedRootPath(gcRoot);
  await assertOwnedRootPath(candidateRoot);
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  const env = withSanitizedInheritedNixConfig(
    envWithResolvedNixBin({ ...(opts.env || process.env) }),
  );
  const nixStore = ensureNixStoreToolPathSync("nix-store", env);
  try {
    await establishRoot({
      gcRoot: candidateRoot,
      storePath: opts.storePath,
      nixStore,
      repoRoot: opts.repoRoot,
      env,
    });
    await establishRoot({
      gcRoot,
      storePath: opts.storePath,
      nixStore,
      repoRoot: opts.repoRoot,
      env,
    });
  } finally {
    const candidate = await fsp.lstat(candidateRoot).catch(() => null);
    if (candidate?.isSymbolicLink()) await fsp.unlink(candidateRoot);
  }
  return gcRoot;
}
