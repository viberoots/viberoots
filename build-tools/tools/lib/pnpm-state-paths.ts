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

export async function pruneOrphanExternalPnpmStateDirs(): Promise<string[]> {
  const base = stablePnpmStateBase();
  const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => []);
  const pruned: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "final-fod") continue;
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
