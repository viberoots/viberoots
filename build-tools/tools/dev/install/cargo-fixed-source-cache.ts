import crypto from "node:crypto";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FixedSourceEntry } from "./cargo-fixed-sources";

const execFileAsync = promisify(execFile);

type CacheEntry = {
  schemaVersion: "viberoots.cargo-fixed-source-cache.v1";
  key: string;
  source: string;
  checksum: string;
  storePath: string;
  narHash: string;
};

export type CachedFixedSource = { storePath: string; narHash: string };
export type FixedSourceCacheOptions = {
  addRoot?: (rootPath: string, storePath: string) => Promise<void>;
};

export function sharedCargoFixedSourceCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const explicit = String(env.VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT || "").trim();
  if (explicit && path.isAbsolute(explicit)) return path.resolve(explicit);
  const xdgCache = String(env.XDG_CACHE_HOME || "").trim();
  const cacheHome = xdgCache && path.isAbsolute(xdgCache) ? xdgCache : path.join(homeDir, ".cache");
  return path.join(cacheHome, "viberoots", "cargo-fixed-source-cache");
}

function cacheDigest(key: string, entry: FixedSourceEntry): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ key, source: entry.source, checksum: entry.checksum }))
    .digest("hex");
}

function cacheFile(root: string, key: string, entry: FixedSourceEntry): string {
  return path.join(root, `${cacheDigest(key, entry)}.json`);
}

export function cachedFixedSourceGcRoot(
  root: string,
  key: string,
  entry: FixedSourceEntry,
): string {
  return path.join(root, "gcroots", `${cacheDigest(key, entry)}.root`);
}

async function executable(file: string): Promise<boolean> {
  return await fsp.access(file, fsp.constants.X_OK).then(
    () => true,
    () => false,
  );
}

async function resolveNixStoreBin(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const explicit = String(env.NIX_STORE_BIN || "").trim();
  if (explicit && path.isAbsolute(explicit) && (await executable(explicit))) return explicit;
  const bootstrap = "/nix/var/nix/profiles/default/bin/nix-store";
  if (await executable(bootstrap)) return bootstrap;
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "nix-store");
    if (await executable(candidate)) return candidate;
  }
  return null;
}

async function addIndirectGcRoot(rootPath: string, storePath: string): Promise<void> {
  const nixStore = await resolveNixStoreBin();
  if (!nixStore) throw new Error("nix-store is unavailable for Cargo fixed-source cache rooting");
  await fsp.mkdir(path.dirname(rootPath), { recursive: true });
  await fsp.rm(rootPath, { force: true });
  await execFileAsync(nixStore, ["--add-root", rootPath, "--indirect", "--realise", storePath], {
    encoding: "utf8",
  });
}

function validCacheEntry(key: string, entry: FixedSourceEntry, cached: CacheEntry): boolean {
  return (
    cached.schemaVersion === "viberoots.cargo-fixed-source-cache.v1" &&
    cached.key === key &&
    cached.source === entry.source &&
    cached.checksum === entry.checksum &&
    /^\/nix\/store\/[a-z0-9]{32}-/.test(cached.storePath) &&
    cached.narHash.startsWith("sha256-")
  );
}

export async function readCachedFixedSource(
  root: string,
  key: string,
  entry: FixedSourceEntry,
  isValidStorePath: (storePath: string) => Promise<boolean>,
): Promise<CachedFixedSource | null> {
  if (!entry.source.startsWith("registry+") || !/^[a-fA-F0-9]{64}$/.test(entry.checksum)) {
    return null;
  }
  const parsed = await fsp
    .readFile(cacheFile(root, key, entry), "utf8")
    .then((raw) => JSON.parse(raw) as CacheEntry)
    .catch(() => null);
  if (!parsed || !validCacheEntry(key, entry, parsed)) return null;
  if (!(await isValidStorePath(parsed.storePath))) return null;
  return { storePath: parsed.storePath, narHash: parsed.narHash };
}

export async function writeCachedFixedSource(
  root: string,
  key: string,
  entry: FixedSourceEntry,
  value: CachedFixedSource,
  options: FixedSourceCacheOptions = {},
): Promise<void> {
  if (!entry.source.startsWith("registry+") || !/^[a-fA-F0-9]{64}$/.test(entry.checksum)) return;
  if (!/^\/nix\/store\/[a-z0-9]{32}-/.test(value.storePath)) return;
  if (!value.narHash.startsWith("sha256-")) return;
  const file = cacheFile(root, key, entry);
  const rootPath = cachedFixedSourceGcRoot(root, key, entry);
  try {
    await (options.addRoot || addIndirectGcRoot)(rootPath, value.storePath);
  } catch {
    // A cache entry that points at an unrooted store path is not durable across
    // `nix store gc`. If rooting is unavailable, skip publishing the cache
    // metadata and leave the already-successful materialization result intact.
    return;
  }
  const payload: CacheEntry = {
    schemaVersion: "viberoots.cargo-fixed-source-cache.v1",
    key,
    source: entry.source,
    checksum: entry.checksum,
    storePath: value.storePath,
    narHash: value.narHash,
  };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(`${file}.${process.pid}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await fsp.rename(`${file}.${process.pid}.tmp`, file);
}
