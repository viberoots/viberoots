import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";

const EXTERNAL_PNPM_STATE_META = "state.json";
let preNoindexStablePnpmStateCleanup: Promise<void> | null = null;

function sanitizeFragment(input: string): string {
  return (
    input
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

function stablePnpmStateBase(): string {
  const override = String(process.env.VBR_PNPM_STATE_BASE || "").trim();
  if (override && path.isAbsolute(override)) return path.resolve(override);
  const tmpBase = process.platform === "win32" ? os.tmpdir() : "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${sanitizeFragment(user)}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  return path.join(tmpBase, `viberoots-pnpm${suffix}${noindex}`);
}

async function removeDarwinPreNoindexStablePnpmStateBase(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (preNoindexStablePnpmStateCleanup) return await preNoindexStablePnpmStateCleanup;
  preNoindexStablePnpmStateCleanup = (async () => {
    const current = stablePnpmStateBase();
    if (!current.endsWith(".noindex")) return;
    await fsp
      .rm(current.slice(0, -".noindex".length), { recursive: true, force: true })
      .catch(() => {});
  })();
  return await preNoindexStablePnpmStateCleanup;
}

export function sharedPnpmStateBasePath(): string {
  return stablePnpmStateBase();
}

export function sharedExactPnpmStateRootPath(lockHash: string): string {
  return path.join(stablePnpmStateBase(), "exact", sanitizeFragment(lockHash));
}

export function sharedExactPnpmStateIndexPath(repoRoot: string, importer: string): string {
  return path.join(
    stablePnpmStateBase(),
    "exact-index",
    `${stateKey(repoRoot)}--${sanitizeFragment(importer)}.json`,
  );
}

export async function sharedExactPnpmStateRoot(lockHash: string): Promise<string> {
  await removeDarwinPreNoindexStablePnpmStateBase();
  const rootDir = sharedExactPnpmStateRootPath(lockHash);
  await mkdirWithMacosMetadataExclusion(path.dirname(path.dirname(rootDir)));
  await mkdirWithMacosMetadataExclusion(path.dirname(rootDir));
  await mkdirWithMacosMetadataExclusion(rootDir);
  return rootDir;
}

function stateKey(scopeAbs: string): string {
  const normalized = path.resolve(scopeAbs);
  const leaf = sanitizeFragment(path.basename(normalized));
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${leaf}-${hash}`;
}

export async function externalPnpmStateDirs(scopeAbs: string): Promise<{
  rootDir: string;
  homeDir: string;
  storeDir: string;
}> {
  await removeDarwinPreNoindexStablePnpmStateBase();
  const normalizedScope = path.resolve(scopeAbs);
  const rootDir = path.join(stablePnpmStateBase(), stateKey(scopeAbs));
  const homeDir = path.join(rootDir, "home");
  const storeDir = path.join(rootDir, "store");
  await mkdirWithMacosMetadataExclusion(stablePnpmStateBase());
  await mkdirWithMacosMetadataExclusion(rootDir);
  await mkdirWithMacosMetadataExclusion(homeDir);
  await mkdirWithMacosMetadataExclusion(storeDir);
  await fsp
    .writeFile(
      path.join(rootDir, EXTERNAL_PNPM_STATE_META),
      JSON.stringify(
        {
          version: 1,
          scopeAbs: normalizedScope,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    )
    .catch(() => {});
  return { rootDir, homeDir, storeDir };
}

export async function removeLegacyImporterPnpmState(importerAbs: string): Promise<void> {
  for (const entry of [".pnpm-home", ".pnpm-store"]) {
    await fsp.rm(path.join(importerAbs, entry), { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeExternalPnpmStateDir(scopeAbs: string): Promise<void> {
  const rootDir = path.join(stablePnpmStateBase(), stateKey(scopeAbs));
  await fsp.rm(rootDir, { recursive: true, force: true }).catch(() => {});
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pathMtimeMs(p: string): Promise<number> {
  const st = await fsp.stat(p).catch(() => null);
  return st?.mtimeMs || 0;
}

async function exactPrepareLockActive(lockPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fsp.readFile(lockPath, "utf8")) as {
      pid?: number;
      startedAtMs?: number;
    };
    return pidAlive(Number(parsed.pid || 0));
  } catch {
    return false;
  }
}

async function pruneExactPnpmStateDirs(base: string): Promise<string[]> {
  const pruned: string[] = [];
  const exactRoot = path.join(base, "exact");
  const indexRoot = path.join(base, "exact-index");
  const liveLockHashes = new Set<string>();
  const indexEntries = await fsp.readdir(indexRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of indexEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const indexPath = path.join(indexRoot, entry.name);
    try {
      const parsed = JSON.parse(await fsp.readFile(indexPath, "utf8")) as {
        repoRoot?: string;
        lockHash?: string;
      };
      const repoRootRaw = String(parsed.repoRoot || "").trim();
      const lockHashRaw = String(parsed.lockHash || "").trim();
      const repoRoot = repoRootRaw ? path.resolve(repoRootRaw) : "";
      const lockHash = lockHashRaw ? sanitizeFragment(lockHashRaw) : "";
      if (!repoRoot || !(await pathExists(repoRoot)) || !lockHash) {
        await fsp.rm(indexPath, { force: true }).catch(() => {});
        pruned.push(indexPath);
        continue;
      }
      liveLockHashes.add(lockHash);
    } catch {
      await fsp.rm(indexPath, { force: true }).catch(() => {});
      pruned.push(indexPath);
    }
  }

  const exactEntries = await fsp.readdir(exactRoot, { withFileTypes: true }).catch(() => []);
  const incompleteTtlRaw = Number.parseInt(
    process.env.VBR_EXACT_PNPM_INCOMPLETE_TTL_MS || "3600000",
    10,
  );
  const incompleteTtlMs =
    Number.isFinite(incompleteTtlRaw) && incompleteTtlRaw >= 0 ? incompleteTtlRaw : 3_600_000;
  for (const entry of exactEntries) {
    if (!entry.isDirectory()) continue;
    const exactDir = path.join(exactRoot, entry.name);
    if (await exactPrepareLockActive(path.join(exactDir, ".prepare.lock"))) continue;
    const readyPath = path.join(exactDir, "ready.json");
    let nixStorePath = "";
    try {
      const parsed = JSON.parse(await fsp.readFile(readyPath, "utf8")) as {
        nixStorePath?: string;
      };
      nixStorePath = String(parsed.nixStorePath || "").trim();
    } catch {}
    const missingReady = !nixStorePath;
    const incompleteAgeMs = Date.now() - (await pathMtimeMs(exactDir));
    if (
      !liveLockHashes.has(entry.name) ||
      (missingReady && incompleteAgeMs > incompleteTtlMs) ||
      (nixStorePath.startsWith("/nix/store/") && !(await pathExists(nixStorePath)))
    ) {
      await fsp.rm(exactDir, { recursive: true, force: true }).catch(() => {});
      pruned.push(exactDir);
    }
  }
  return pruned;
}

export async function pruneOrphanExternalPnpmStateDirs(): Promise<string[]> {
  const base = stablePnpmStateBase();
  const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => []);
  const pruned: string[] = [];
  pruned.push(...(await pruneExactPnpmStateDirs(base)));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "exact" || entry.name === "exact-index") continue;
    const rootDir = path.join(base, entry.name);
    const metaPath = path.join(rootDir, EXTERNAL_PNPM_STATE_META);
    let scopeAbs = "";
    try {
      const parsed = JSON.parse(await fsp.readFile(metaPath, "utf8")) as { scopeAbs?: string };
      scopeAbs = path.resolve(String(parsed.scopeAbs || ""));
    } catch {
      continue;
    }
    if (!scopeAbs || (await pathExists(scopeAbs))) continue;
    await fsp.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    pruned.push(rootDir);
  }
  return pruned;
}
