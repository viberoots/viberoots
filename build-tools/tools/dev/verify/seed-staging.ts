import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { copyTree } from "../../lib/copy-tree";
import { pidAlive } from "./seed-utils";

const REQUIRED_STAGE_FILES = [
  "flake.nix",
  ".buckconfig",
  "eslint.config.js",
  path.join("build-tools", "deployments", "defs.bzl"),
  path.join("build-tools", "tools", "buck", "export-graph.ts"),
  path.join("build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
];

export function seedStageRootDirForTest(): string {
  if (process.platform === "win32") return path.join(os.tmpdir(), "bucknix-test-seed");
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  return path.join("/tmp", `bucknix-test-seed${suffix}`);
}

function seedStageRootDir(): string {
  return seedStageRootDirForTest();
}

function seedStageKey(seedKey: string): string {
  return crypto.createHash("sha256").update(seedKey).digest("hex").slice(0, 12);
}

function seedStageDir(seedKey: string): string {
  return path.join(seedStageRootDir(), `seed-${seedStageKey(seedKey)}`);
}

function seedStageLockDir(seedKey: string): string {
  return path.join(seedStageRootDir(), `lock-${seedStageKey(seedKey)}`);
}

async function ensureWritableTree(root: string): Promise<void> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) await fsp.chmod(abs, st.mode | 0o200).catch(() => {});
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) await fsp.chmod(abs, st.mode | 0o200).catch(() => {});
      }
    }
  }
}

async function makeReadOnlyTree(root: string): Promise<void> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) await fsp.chmod(abs, st.mode & ~0o222).catch(() => {});
      }
    }
    const st = await fsp.stat(dir).catch(() => null);
    if (st) await fsp.chmod(dir, st.mode & ~0o222).catch(() => {});
  }
}

async function missingRequiredStageFiles(root: string): Promise<string[]> {
  const missing: string[] = [];
  for (const rel of REQUIRED_STAGE_FILES) {
    const ok = await fsp
      .access(path.join(root, rel))
      .then(() => true)
      .catch(() => false);
    if (!ok) missing.push(rel);
  }
  return missing;
}

async function stageReady(stageDir: string, seedKey: string): Promise<boolean> {
  const keyFile = path.join(stageDir, "seed.key");
  const readyFile = path.join(stageDir, ".seed-store-ready");
  const existingKey = await fsp.readFile(keyFile, "utf8").catch(() => "");
  if (existingKey.trim() !== seedKey) return false;
  const hasReady = await fsp
    .access(readyFile)
    .then(() => true)
    .catch(() => false);
  if (!hasReady) return false;
  return (await missingRequiredStageFiles(stageDir)).length === 0;
}

async function statDev(pathToStat: string): Promise<number | null> {
  try {
    const st = await fsp.stat(pathToStat);
    return typeof st.dev === "number" ? st.dev : null;
  } catch {
    return null;
  }
}

export async function shouldStageSeed(seedPath: string): Promise<boolean> {
  const seedDev = await statDev(seedPath);
  const tmpDev = await statDev(os.tmpdir());
  if (seedDev === null || tmpDev === null) return false;
  return seedDev !== tmpDev;
}

async function readLockOwner(lockDir: string): Promise<{ pid: number; startedAt: string }> {
  const ownerFile = path.join(lockDir, "owner.json");
  const txt = await fsp.readFile(ownerFile, "utf8").catch(() => "");
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

async function acquireSeedStageLock(
  seedKey: string,
  seedTtlMs: number,
): Promise<() => Promise<void>> {
  const lockDir = seedStageLockDir(seedKey);
  await fsp.mkdir(seedStageRootDir(), { recursive: true }).catch(() => {});
  const startedAt = new Date().toISOString();
  const maxWaitMs = 5 * 60 * 1000;
  const deadline = Date.now() + maxWaitMs;
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
    } catch (e: any) {
      if (e && e.code !== "EEXIST") throw e;
      const owner = await readLockOwner(lockDir);
      const ownerMs = owner.startedAt ? Date.parse(owner.startedAt) : 0;
      const ageMs = ownerMs ? Date.now() - ownerMs : seedTtlMs + 1;
      const stale = !pidAlive(owner.pid) || ageMs > seedTtlMs;
      if (stale) {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      await sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 2000);
    }
  }
  throw new Error(`verify seed: timed out waiting for seed lock ${lockDir}`);
}

export async function stageSeedStore(
  seedPath: string,
  seedKey: string,
  seedTtlMs: number,
): Promise<string> {
  const stageDir = seedStageDir(seedKey);
  const keyFile = path.join(stageDir, "seed.key");
  const readyFile = path.join(stageDir, ".seed-store-ready");
  if (await stageReady(stageDir, seedKey)) {
    await ensureWritableTree(stageDir);
    await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
    await makeReadOnlyTree(stageDir);
    return stageDir;
  }
  const release = await acquireSeedStageLock(seedKey, seedTtlMs);
  try {
    if (await stageReady(stageDir, seedKey)) {
      await ensureWritableTree(stageDir);
      await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
      await makeReadOnlyTree(stageDir);
      return stageDir;
    }
    await ensureWritableTree(stageDir).catch(() => {});
    await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    await fsp.mkdir(path.dirname(stageDir), { recursive: true }).catch(() => {});
    await copyTree(seedPath, stageDir, { cloneMode: "none", force: true });
    await fsp.writeFile(keyFile, seedKey + "\n", "utf8");
    await fsp.writeFile(readyFile, "ok\n", "utf8");
    await makeReadOnlyTree(stageDir);
    return stageDir;
  } finally {
    await release();
  }
}
