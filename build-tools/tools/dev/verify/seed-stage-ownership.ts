import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import {
  canonicalSeedStageRoot,
  seedStageDir,
  seedStageLockDir,
  seedStageRootDir,
} from "./seed-stage-layout";
import { removeWritableTree } from "./seed-stage-tree";
import { pidAlive } from "./seed-utils";

type LockOwner = { pid: number; startedAt: string };

async function readLockOwner(lockDir: string): Promise<LockOwner> {
  const txt = await fsp.readFile(path.join(lockDir, "owner.json"), "utf8").catch(() => "");
  try {
    const parsed = JSON.parse(txt || "{}");
    return {
      pid: Number(parsed.pid || 0),
      startedAt: String(parsed.startedAt || ""),
    };
  } catch {
    return { pid: 0, startedAt: "" };
  }
}

async function lockIsStale(lockDir: string, seedTtlMs: number): Promise<boolean> {
  const owner = await readLockOwner(lockDir);
  const ownerMs = owner.startedAt ? Date.parse(owner.startedAt) : 0;
  const ageMs = ownerMs ? Date.now() - ownerMs : seedTtlMs + 1;
  return !pidAlive(owner.pid) || ageMs > seedTtlMs;
}

async function livePinnedSeedStageDirs(workspaceRoot?: string): Promise<Set<string>> {
  const pinned = new Set<string>();
  if (!workspaceRoot) return pinned;
  const pinsDir = path.join(
    workspaceRoot,
    ".viberoots",
    "workspace",
    "buck",
    "verify-seed",
    "pins",
  );
  const entries = await fsp.readdir(pinsDir, { withFileTypes: true }).catch(() => []);
  const canonicalRoot = await canonicalSeedStageRoot();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pinDir = path.join(pinsDir, entry.name);
    const owner = await fsp
      .readFile(path.join(pinDir, "owner.json"), "utf8")
      .then((txt) => JSON.parse(txt) as { pid?: number })
      .catch(() => null);
    if (!owner || !pidAlive(Number(owner.pid || 0))) continue;
    const target = await fsp.readlink(path.join(pinDir, "seed")).catch(() => "");
    if (!target) continue;
    const resolved = path.resolve(pinDir, target);
    const canonicalTarget = await fsp.realpath(resolved).catch(() => resolved);
    if (path.dirname(canonicalTarget) === canonicalRoot) pinned.add(path.basename(canonicalTarget));
  }
  return pinned;
}

async function liveSharedPinnedSeedStageDirs(): Promise<Set<string>> {
  const pinned = new Set<string>();
  const root = seedStageRootDir();
  const canonicalRoot = await canonicalSeedStageRoot();
  const pinsDir = path.join(root, "pins");
  const entries = await fsp.readdir(pinsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pinDir = path.join(pinsDir, entry.name);
    const owner = await fsp
      .readFile(path.join(pinDir, "owner.json"), "utf8")
      .then((txt) => JSON.parse(txt) as { pid?: number })
      .catch(() => null);
    if (!owner || !pidAlive(Number(owner.pid || 0))) {
      await fsp.rm(pinDir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    const target = await fsp.readlink(path.join(pinDir, "seed")).catch(() => "");
    if (!target) continue;
    const resolved = path.resolve(pinDir, target);
    const canonicalTarget = await fsp.realpath(resolved).catch(() => resolved);
    if (path.dirname(canonicalTarget) === canonicalRoot) pinned.add(path.basename(canonicalTarget));
  }
  return pinned;
}

async function liveLockedSeedStageDirs(seedTtlMs: number): Promise<Set<string>> {
  const locked = new Set<string>();
  const root = seedStageRootDir();
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("lock-")) continue;
    if (await lockIsStale(path.join(root, entry.name), seedTtlMs)) continue;
    locked.add(`seed-${entry.name.slice("lock-".length)}`);
  }
  return locked;
}

export async function sweepStaleSeedStages(
  seedKey: string,
  seedTtlMs: number,
  workspaceRoot?: string,
): Promise<void> {
  const root = seedStageRootDir();
  const keepSeedDir = path.basename(seedStageDir(seedKey));
  const keepLockDir = path.basename(seedStageLockDir(seedKey));
  const livePinnedDirs = await livePinnedSeedStageDirs(workspaceRoot);
  const liveSharedPinnedDirs = await liveSharedPinnedSeedStageDirs();
  const liveLockedDirs = await liveLockedSeedStageDirs(seedTtlMs);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(root, entry.name);
    if (entry.name.startsWith("lock-")) {
      if (entry.name !== keepLockDir && (await lockIsStale(abs, seedTtlMs))) {
        await fsp.rm(abs, { recursive: true, force: true }).catch(() => {});
      }
      continue;
    }
    if (!entry.name.startsWith("seed-") || entry.name === keepSeedDir) continue;
    if (livePinnedDirs.has(entry.name)) continue;
    if (liveSharedPinnedDirs.has(entry.name)) continue;
    if (liveLockedDirs.has(entry.name)) continue;
    await removeWritableTree(abs);
  }
}

export async function createSharedSeedStagePin(
  seedPath: string,
  iso: string,
): Promise<string | null> {
  const root = seedStageRootDir();
  const canonicalRoot = await canonicalSeedStageRoot();
  const resolved = await fsp.realpath(seedPath).catch(() => seedPath);
  if (path.dirname(resolved) !== canonicalRoot) return null;
  const pinDir = path.join(root, "pins", iso);
  await mkdirWithMacosMetadataExclusion(pinDir).catch(() => {});
  await fsp.writeFile(
    path.join(pinDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
  const link = path.join(pinDir, "seed");
  await fsp.rm(link, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(resolved, link).catch(() => {});
  return pinDir;
}

export async function acquireSeedStageLock(
  seedKey: string,
  seedTtlMs: number,
): Promise<() => Promise<void>> {
  const lockDir = seedStageLockDir(seedKey);
  await mkdirWithMacosMetadataExclusion(seedStageRootDir()).catch(() => {});
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 5 * 60 * 1000;
  let waitMs = 200;
  while (Date.now() < deadline) {
    try {
      await fsp.mkdir(lockDir, { recursive: false });
      await fsp.writeFile(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt }) + "\n",
        "utf8",
      );
      return async () => {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      if (await lockIsStale(lockDir, seedTtlMs)) {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      await sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 2000);
    }
  }
  throw new Error(`verify seed: timed out waiting for seed lock ${lockDir}`);
}
