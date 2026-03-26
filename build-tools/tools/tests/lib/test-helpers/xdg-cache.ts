import * as fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ensuredXdgCacheRoots = new Map<string, Promise<void>>();

function isValidBareGitRepo(repoPath: string): boolean {
  const probe = spawnSync("git", ["-C", repoPath, "rev-parse", "--is-bare-repository"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return probe.status === 0 && String(probe.stdout || "").trim() === "true";
}

async function ensureSharedNixTarballCacheRepoInner(xdgCacheHome: string): Promise<void> {
  const nixCacheDir = path.join(xdgCacheHome, "nix");
  const tarballCacheRepo = path.join(nixCacheDir, "tarball-cache-v2");
  await fsp.mkdir(nixCacheDir, { recursive: true });
  const stat = await fsp.stat(tarballCacheRepo).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory() && isValidBareGitRepo(tarballCacheRepo)) return;
  await fsp.rm(tarballCacheRepo, { recursive: true, force: true });
}

export async function ensureSharedNixTarballCacheRepo(xdgCacheHome: string): Promise<void> {
  const cacheKey = path.resolve(xdgCacheHome);
  let pending = ensuredXdgCacheRoots.get(cacheKey);
  if (!pending) {
    pending = ensureSharedNixTarballCacheRepoInner(cacheKey);
    ensuredXdgCacheRoots.set(cacheKey, pending);
  }
  try {
    await pending;
  } catch (error) {
    ensuredXdgCacheRoots.delete(cacheKey);
    throw error;
  }
}
