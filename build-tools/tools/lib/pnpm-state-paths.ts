import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

export function sharedExactPnpmStateRootPath(lockHash: string): string {
  return path.join(stablePnpmStateBase(), "exact", sanitizeFragment(lockHash));
}

export function sharedExactPnpmStateIndexPath(importer: string): string {
  return path.join(stablePnpmStateBase(), "exact-index", `${sanitizeFragment(importer)}.json`);
}

export async function sharedExactPnpmStateRoot(lockHash: string): Promise<string> {
  const rootDir = sharedExactPnpmStateRootPath(lockHash);
  await fsp.mkdir(rootDir, { recursive: true });
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
  const rootDir = path.join(stablePnpmStateBase(), stateKey(scopeAbs));
  const homeDir = path.join(rootDir, "home");
  const storeDir = path.join(rootDir, "store");
  await fsp.mkdir(homeDir, { recursive: true });
  await fsp.mkdir(storeDir, { recursive: true });
  return { rootDir, homeDir, storeDir };
}

export async function removeLegacyImporterPnpmState(importerAbs: string): Promise<void> {
  for (const entry of [".pnpm-home", ".pnpm-store"]) {
    await fsp.rm(path.join(importerAbs, entry), { recursive: true, force: true }).catch(() => {});
  }
}
