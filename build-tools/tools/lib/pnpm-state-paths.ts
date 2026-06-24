import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";

const EXTERNAL_PNPM_STATE_META = "state.json";

function sanitizeFragment(input: string): string {
  return (
    input
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

function stablePnpmStateBase(): string {
  const tmpBase = process.platform === "win32" ? os.tmpdir() : "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${sanitizeFragment(user)}` : "";
  return path.join(tmpBase, `viberoots-pnpm${suffix}`);
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function pruneOrphanExternalPnpmStateDirs(): Promise<string[]> {
  const base = stablePnpmStateBase();
  const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => []);
  const pruned: string[] = [];
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
