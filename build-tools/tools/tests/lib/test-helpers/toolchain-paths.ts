import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { repoRoot, pathExists } from "../../../lib/repo";

let cachedSource: Promise<{ bzl: string; json: string } | null> | null = null;

function resolveSourceRoot(): string {
  const envRoot = String(process.env.REPO_ROOT || process.env.LIVE_ROOT || "").trim();
  return envRoot || repoRoot();
}

async function hasValidGeneratedToolchainPaths(
  bzlPath: string,
  jsonPath: string,
): Promise<boolean> {
  if (!(await pathExists(bzlPath)) || !(await pathExists(jsonPath))) return false;
  try {
    const raw = await fsp.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      go?: { bin?: string; root?: string };
      python?: { bin?: string };
    };
    const goBin = String(parsed?.go?.bin || "").trim();
    const goRoot = String(parsed?.go?.root || "").trim();
    const pyBin = String(parsed?.python?.bin || "").trim();
    if (!goBin || !goRoot || !pyBin) return false;
    await fsp.access(goBin);
    await fsp.access(goRoot);
    await fsp.access(pyBin);
    return true;
  } catch {
    return false;
  }
}

async function withToolchainGenerationLock(root: string, fn: () => Promise<void>): Promise<void> {
  const lockDir = path.join(root, "buck-out", "tmp", "locks", "toolchain-paths-generation.lock");
  await fsp.mkdir(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + 5 * 60 * 1000;
  let waitMs = 100;
  while (Date.now() < deadline) {
    try {
      await fsp.mkdir(lockDir);
      try {
        await fn();
      } finally {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      }
      return;
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      await sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 1500);
    }
  }
  throw new Error("toolchain paths generation lock timeout");
}

async function ensureSourceFiles($: any): Promise<{ bzl: string; json: string }> {
  if (!cachedSource) {
    cachedSource = (async () => {
      const root = resolveSourceRoot();
      const bzl = path.join(root, "toolchains", "toolchain_paths.bzl");
      const json = path.join(root, "build-tools", "tools", "dev", "toolchain-paths.json");

      if (await hasValidGeneratedToolchainPaths(bzl, json)) return { bzl, json };

      await withToolchainGenerationLock(root, async () => {
        if (await hasValidGeneratedToolchainPaths(bzl, json)) return;
        await $({
          cwd: root,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/dev/gen-toolchain-paths.ts`;
      });

      if (!(await hasValidGeneratedToolchainPaths(bzl, json))) {
        throw new Error("toolchain paths generation failed");
      }
      return { bzl, json };
    })();
  }
  const out = await cachedSource;
  if (!out) throw new Error("toolchain paths generation failed");
  return out;
}

async function copyIfMissing(src: string, dst: string): Promise<void> {
  if (await pathExists(dst)) return;
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
}

export async function ensureToolchainPathsForTempRepo(tmp: string, $: any): Promise<void> {
  const src = await ensureSourceFiles($);
  const bzlDst = path.join(tmp, "toolchains", "toolchain_paths.bzl");
  const jsonDst = path.join(tmp, "build-tools", "tools", "dev", "toolchain-paths.json");
  await copyIfMissing(src.bzl, bzlDst);
  await copyIfMissing(src.json, jsonDst);
}
