import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { setTimeout as sleep } from "node:timers/promises";
import { copyTree } from "../../lib/copy-tree";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../lib/macos-metadata";
import {
  GENERATED_REPO_STATE_PATHS,
  isGeneratedRepoStateRelPath,
} from "./generated-state-excludes";
import { pidAlive } from "./seed-utils";

const REQUIRED_STAGE_FILES = [
  path.join(".viberoots", "workspace", "flake.nix"),
  ".buckconfig",
  path.join("viberoots", "eslint.config.js"),
  path.join("viberoots", "build-tools", "deployments", "defs.bzl"),
  path.join("viberoots", "build-tools", "tools", "buck", "export-graph.ts"),
  path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("viberoots", "build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "flake.nix"),
];
const PREPARED_MARKER = ".seed-store-prepared-v7";
const STAGE_ROOT_PROTOCOL_DIR = "stage-v8";

export function seedStageRootDirForTest(): string {
  const override = String(process.env.VBR_VERIFY_SEED_STAGE_ROOT || "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-test-seed");
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const name = `viberoots-test-seed${suffix}`;
  const base =
    process.platform === "darwin" ? path.join("/tmp", `${name}.noindex`) : path.join("/tmp", name);
  return path.join(base, STAGE_ROOT_PROTOCOL_DIR);
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

async function pathMtimeMs(p: string): Promise<number> {
  const st = await fsp.stat(p).catch(() => null);
  return st?.mtimeMs || 0;
}

async function removeWritableTree(root: string): Promise<void> {
  await ensureWritableTree(root).catch(() => {});
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
}

async function ensureWritableTree(root: string): Promise<void> {
  const rootSt = await fsp.stat(root).catch(() => null);
  if (rootSt) await fsp.chmod(root, rootSt.mode | 0o700).catch(() => {});
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

async function hasGeneratedRepoState(root: string): Promise<boolean> {
  for (const rel of GENERATED_REPO_STATE_PATHS) {
    const exists = await fsp
      .access(path.join(root, rel))
      .then(() => true)
      .catch(() => false);
    if (exists) return true;
  }
  return false;
}

async function stageReady(stageDir: string, seedKey: string): Promise<boolean> {
  const keyFile = path.join(stageDir, "seed.key");
  const readyFile = path.join(stageDir, ".seed-store-ready");
  const preparedFile = path.join(stageDir, PREPARED_MARKER);
  const existingKey = await fsp.readFile(keyFile, "utf8").catch(() => "");
  if (existingKey.trim() !== seedKey) return false;
  const hasReady = await fsp
    .access(readyFile)
    .then(() => true)
    .catch(() => false);
  if (!hasReady) return false;
  const hasPrepared = await fsp
    .access(preparedFile)
    .then(() => true)
    .catch(() => false);
  if (!hasPrepared) return false;
  if (await hasGeneratedRepoState(stageDir)) return false;
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

function parseGitStatusRel(line: string): { rel: string; deleted: boolean } | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const raw = line.slice(3).trim();
  if (!raw) return null;
  const renameSep = raw.indexOf(" -> ");
  const rel = (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
  if (!rel || rel.startsWith(".git/") || rel === ".git") return null;
  return { rel, deleted: status.includes("D") };
}

async function activeViberootsRoot(workspaceRoot: string): Promise<string> {
  const nested = path.join(workspaceRoot, "viberoots");
  const nestedOk = await fsp
    .access(path.join(nested, "build-tools", "tools", "dev", "zx-init.mjs"))
    .then(() => true)
    .catch(() => false);
  return nestedOk ? nested : workspaceRoot;
}

async function listActiveSourceOverlayFiles(source: string): Promise<{
  changed: string[];
  deleted: string[];
}> {
  const out = await $({
    stdio: "pipe",
    cwd: source,
  })`git status --porcelain=v1 --untracked-files=all`
    .nothrow()
    .quiet();
  if (out.exitCode !== 0) return { changed: [], deleted: [] };
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of String(out.stdout || "").split(/\r?\n/)) {
    const entry = parseGitStatusRel(line);
    if (!entry) continue;
    if (isGeneratedRepoStateRelPath(entry.rel)) continue;
    if (entry.deleted) {
      deleted.push(entry.rel);
      continue;
    }
    const abs = path.join(source, entry.rel);
    const st = await fsp.lstat(abs).catch(() => null);
    if (!st || st.isDirectory()) continue;
    changed.push(entry.rel);
  }
  return {
    changed: Array.from(new Set(changed)).sort((a, b) => a.localeCompare(b)),
    deleted: Array.from(new Set(deleted)).sort((a, b) => a.localeCompare(b)),
  };
}

async function overlayActiveViberootsIntoStage(stageDir: string, workspaceRoot: string) {
  const source = await activeViberootsRoot(workspaceRoot);
  const overlay = await listActiveSourceOverlayFiles(source);
  const touched = [...overlay.changed, ...overlay.deleted].map((rel) =>
    path.join("viberoots", rel),
  );
  const stageViberoots = path.join(stageDir, "viberoots");
  for (const rel of overlay.deleted) {
    await fsp.rm(path.join(stageViberoots, rel), { recursive: true, force: true });
  }
  if (overlay.changed.length > 0) {
    const fileList = await mkdtempNoindex(".seed-viberoots-overlay-", {
      baseName: ".seed-viberoots-overlay",
      tmpBase: stageDir,
    });
    const listPath = path.join(fileList, "files.txt");
    await fsp.writeFile(listPath, overlay.changed.join("\n") + "\n", "utf8");
    try {
      await $({ cwd: source })`rsync -a --relative --files-from ${listPath} ./ ${stageViberoots}/`;
    } finally {
      await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
    }
  }
  return touched;
}

type PathFlakeMetadata = {
  lastModified?: number;
  narHash?: string;
};

async function readPathFlakeMetadata(inputPath: string): Promise<PathFlakeMetadata> {
  const canonicalInputPath = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await $({
    stdio: "pipe",
  })`nix flake prefetch --json ${`path:${canonicalInputPath}`}`.nothrow();
  if (prefetched.exitCode === 0) {
    const parsed = JSON.parse(String(prefetched.stdout || "{}"));
    const locked = parsed?.locked || {};
    return {
      lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
      narHash: typeof locked.narHash === "string" ? locked.narHash : undefined,
    };
  }
  const out = await $({
    stdio: "pipe",
  })`nix flake metadata --json ${`path:${canonicalInputPath}`} --no-write-lock-file`;
  const parsed = JSON.parse(String(out.stdout || "{}"));
  const locked = parsed?.locked || {};
  const narHash =
    typeof locked.narHash === "string"
      ? locked.narHash
      : String(
          (
            await $({
              stdio: "pipe",
            })`nix hash path --sri ${canonicalInputPath}`
          ).stdout || "",
        ).trim();
  return {
    lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
    narHash: narHash || undefined,
  };
}

function rewriteLocalPathLockEntry(
  entry: unknown,
  pathValue: string,
  metadata?: PathFlakeMetadata,
): boolean {
  if (!entry || typeof entry !== "object") return false;
  const node = entry as { type?: unknown; path?: unknown; url?: unknown };
  const rawPath =
    node.type === "path"
      ? String(node.path || "")
      : node.type === "git" && String(node.url || "").startsWith("file:")
        ? String(node.url || "").replace(/^file:/, "")
        : "";
  if (!rawPath || path.basename(rawPath) !== "viberoots") return false;
  const mutableNode = node as {
    lastModified?: number;
    lastModifiedDate?: string;
    narHash?: string;
    path: unknown;
    rev?: string;
    revCount?: number;
    type: unknown;
    url?: string;
  };
  mutableNode.type = "path";
  mutableNode.path = pathValue;
  if (metadata?.lastModified) mutableNode.lastModified = metadata.lastModified;
  if (metadata?.narHash) mutableNode.narHash = metadata.narHash;
  delete mutableNode.lastModifiedDate;
  delete mutableNode.rev;
  delete mutableNode.revCount;
  delete mutableNode.url;
  return true;
}

async function rewriteStageViberootsInput(stageDir: string): Promise<string[]> {
  const touched: string[] = [];
  const flakePath = path.join(stageDir, ".viberoots", "workspace", "flake.nix");
  const flakeText = await fsp.readFile(flakePath, "utf8").catch(() => "");
  if (flakeText) {
    const next = flakeText.replace(
      /(\bviberoots\.url\s*=\s*)"[^"]*"/,
      (_match, prefix: string) => `${prefix}"path:./viberoots"`,
    );
    if (next !== flakeText) {
      await fsp.writeFile(flakePath, next, "utf8");
      touched.push(path.join(".viberoots", "workspace", "flake.nix"));
    }
  }

  const lockPath = path.join(stageDir, ".viberoots", "workspace", "flake.lock");
  const lockText = await fsp.readFile(lockPath, "utf8").catch(() => "");
  if (lockText) {
    const metadata = await readPathFlakeMetadata(path.join(stageDir, "viberoots"));
    let lock: any;
    try {
      lock = JSON.parse(lockText);
    } catch {
      lock = null;
    }
    const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
    const node = lock?.nodes?.[inputName] || lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
    if (node && typeof node === "object") {
      const lockedChanged = rewriteLocalPathLockEntry(node.locked, "./viberoots", metadata);
      const originalChanged = rewriteLocalPathLockEntry(node.original, "./viberoots");
      if (lockedChanged || originalChanged) {
        await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
        touched.push(path.join(".viberoots", "workspace", "flake.lock"));
      }
    }
  }
  return touched;
}

async function gitStageRelPaths(stageDir: string, relPaths: string[]): Promise<void> {
  const existing: string[] = [];
  const forceExisting: string[] = [];
  const missing: string[] = [];
  for (const rel of Array.from(new Set(relPaths)).sort((a, b) => a.localeCompare(b))) {
    const normalized = rel.split(path.sep).join("/");
    const abs = path.join(stageDir, normalized);
    const exists = await fsp
      .access(abs)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      if (normalized.startsWith(".viberoots/")) forceExisting.push(normalized);
      else existing.push(normalized);
    } else {
      missing.push(normalized);
    }
  }
  const git = $({ cwd: stageDir, stdio: "pipe" });
  if (existing.length > 0) await git`git add -- ${existing}`;
  if (forceExisting.length > 0) await git`git add -f -- ${forceExisting}`;
  if (missing.length > 0) await git`git rm -q --ignore-unmatch -- ${missing}`;
}

async function trackedNpmrcDirs(stageDir: string): Promise<string[]> {
  const out = await $({ cwd: stageDir, stdio: "pipe" })`git ls-files -- "**/.npmrc"`
    .nothrow()
    .quiet();
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rel) => path.join(stageDir, path.dirname(rel)));
}

async function ensurePnpmfilePlaceholders(stageDir: string): Promise<string[]> {
  const dirs = new Set<string>([
    stageDir,
    path.join(stageDir, "viberoots"),
    ...(await trackedNpmrcDirs(stageDir)),
  ]);
  const placeholder = "export default {};\n";
  const touched: string[] = [];
  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, ".pnpmfile.mjs");
      await fsp.writeFile(file, placeholder, { flag: "wx" });
      touched.push(path.relative(stageDir, file).split(path.sep).join("/"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
    }
  }
  return touched;
}

async function prepareStageSeed(stageDir: string, workspaceRoot: string): Promise<void> {
  const touched = [
    ...(await overlayActiveViberootsIntoStage(stageDir, workspaceRoot)),
    ...(await ensurePnpmfilePlaceholders(stageDir)),
    ...(await rewriteStageViberootsInput(stageDir)),
  ];
  if (touched.length > 0) {
    await gitStageRelPaths(stageDir, touched);
    await $({
      cwd: stageDir,
      stdio: "pipe",
    })`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay --allow-empty`
      .nothrow()
      .quiet();
  }
  await fsp.writeFile(path.join(stageDir, PREPARED_MARKER), "ok\n", "utf8");
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
  const root = seedStageRootDir();
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
    if (path.dirname(resolved) === root) pinned.add(path.basename(resolved));
  }
  return pinned;
}

async function liveSharedPinnedSeedStageDirs(): Promise<Set<string>> {
  const pinned = new Set<string>();
  const root = seedStageRootDir();
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
    if (path.dirname(resolved) === root) pinned.add(path.basename(resolved));
  }
  return pinned;
}

async function liveLockedSeedStageDirs(seedTtlMs: number): Promise<Set<string>> {
  const locked = new Set<string>();
  const root = seedStageRootDir();
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("lock-")) continue;
    const lockDir = path.join(root, entry.name);
    if (await lockIsStale(lockDir, seedTtlMs)) continue;
    locked.add(`seed-${entry.name.slice("lock-".length)}`);
  }
  return locked;
}

async function sweepStaleSeedStages(
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
  const resolved = await fsp.realpath(seedPath).catch(() => seedPath);
  if (path.dirname(resolved) !== root) return null;
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

async function acquireSeedStageLock(
  seedKey: string,
  seedTtlMs: number,
): Promise<() => Promise<void>> {
  const lockDir = seedStageLockDir(seedKey);
  await mkdirWithMacosMetadataExclusion(seedStageRootDir()).catch(() => {});
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
  opts: { workspaceRoot?: string; sharedPinIso?: string } = {},
): Promise<string> {
  await sweepStaleSeedStages(seedKey, seedTtlMs, opts.workspaceRoot);
  const stageDir = seedStageDir(seedKey);
  const keyFile = path.join(stageDir, "seed.key");
  const readyFile = path.join(stageDir, ".seed-store-ready");
  const publishReadyStage = async () => {
    if (opts.sharedPinIso) await createSharedSeedStagePin(stageDir, opts.sharedPinIso);
    return stageDir;
  };
  if (await stageReady(stageDir, seedKey)) {
    await ensureWritableTree(stageDir);
    await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
    await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
    return await publishReadyStage();
  }
  const release = await acquireSeedStageLock(seedKey, seedTtlMs);
  try {
    if (await stageReady(stageDir, seedKey)) {
      await ensureWritableTree(stageDir);
      await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
      await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
      return await publishReadyStage();
    }
    await ensureWritableTree(stageDir).catch(() => {});
    await fsp.rm(stageDir, { recursive: true, force: true }).catch(async () => {
      await ensureWritableTree(stageDir).catch(() => {});
      await fsp.rm(stageDir, { recursive: true, force: true });
    });
    await mkdirWithMacosMetadataExclusion(path.dirname(stageDir)).catch(() => {});
    await copyTree(seedPath, stageDir, {
      cloneMode: "none",
      exclude: isGeneratedRepoStateRelPath,
      force: true,
    });
    await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
    await ensureWritableTree(stageDir);
    if (opts.workspaceRoot) {
      await prepareStageSeed(stageDir, opts.workspaceRoot);
    } else {
      await fsp.writeFile(path.join(stageDir, PREPARED_MARKER), "ok\n", "utf8");
    }
    await fsp.writeFile(keyFile, seedKey + "\n", "utf8");
    await fsp.writeFile(readyFile, "ok\n", "utf8");
    return await publishReadyStage();
  } finally {
    await release();
  }
}
