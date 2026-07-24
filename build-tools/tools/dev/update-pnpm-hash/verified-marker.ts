import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { withExclusiveInstallLock } from "../install/lock";
import { updateNodeModulesHashesJson } from "./hashes-json";
import type { HashesJsonOwner } from "./hashes-json";

export type PnpmStoreVerifiedMarker = {
  importer: string;
  lockfile: string;
  lockHash: string;
  hashValue: string;
  builderFingerprint: string;
  derivationIdentity: string;
};

export type SharedPnpmStoreHashCacheEntry = {
  lockHash: string;
  hashValue: string;
  authorityDerivationIdentity: string;
  finalDerivationIdentity: string;
};

const pnpmStoreBuilderFingerprintFiles = [
  ".viberoots/workspace/flake.lock",
  "viberoots/build-tools/tools/nix/flake/for-all-systems.nix",
  "viberoots/build-tools/tools/nix/flake/per-system-context.nix",
  "viberoots/build-tools/tools/nix/flake/packages/default.nix",
  "viberoots/build-tools/tools/nix/flake/packages/node-mods.nix",
  "viberoots/build-tools/tools/nix/node-modules.nix",
  "viberoots/build-tools/tools/nix/node-modules/common.nix",
  "viberoots/build-tools/tools/nix/node-modules/store.nix",
  "viberoots/build-tools/tools/nix/node-modules/modules.nix",
  "viberoots/build-tools/tools/nix/node-modules/supported-platforms.nix",
] as const;

async function readFingerprintFile(repoRoot: string, rel: string): Promise<string> {
  const primary = path.join(repoRoot, rel);
  try {
    return await fsp.readFile(primary, "utf8");
  } catch {}
  if (rel.startsWith("viberoots/")) {
    try {
      return await fsp.readFile(path.join(repoRoot, rel.slice("viberoots/".length)), "utf8");
    } catch {}
  }
  return "<missing>";
}

export function verifiedMarkerPath(repoRoot: string, importer: string): string {
  const key =
    importer === "." ? "root" : importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(
    repoRoot,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    `pnpm-store-verified.${key}.json`,
  );
}

export function sharedPnpmStoreHashCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const explicitRoot = String(env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT || "").trim();
  if (explicitRoot && path.isAbsolute(explicitRoot)) {
    return path.resolve(explicitRoot);
  }
  const xdgCache = String(env.XDG_CACHE_HOME || "").trim();
  const cacheHome = xdgCache && path.isAbsolute(xdgCache) ? xdgCache : path.join(homeDir, ".cache");
  return path.join(cacheHome, "viberoots", "pnpm-store-hash-authority");
}

function validDerivationIdentity(value: string): boolean {
  return /^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/.test(value);
}

function sharedHashCachePath(authorityDerivationIdentity: string, lockHash: string): string {
  const authorityKey = crypto
    .createHash("sha256")
    .update(authorityDerivationIdentity)
    .digest("hex");
  return path.join(
    sharedPnpmStoreHashCacheRoot(),
    ".viberoots",
    "workspace",
    "buck",
    "pnpm-store-hash-cache",
    authorityKey,
    `${lockHash}.json`,
  );
}

async function snapshotOwnedFile(file: string): Promise<{
  restore: () => Promise<void>;
}> {
  const before = await fsp.readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  });
  return {
    restore: async () => {
      if (before === null) {
        await fsp.rm(file, { force: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        });
        return;
      }
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, before);
    },
  };
}

async function restoreOwnedFilesOrThrow(
  snapshots: Array<{ restore: () => Promise<void> }>,
  primary: unknown,
): Promise<void> {
  const rollbackErrors: unknown[] = [];
  for (const snapshot of snapshots.reverse()) {
    try {
      await snapshot.restore();
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [primary, ...rollbackErrors],
      "verified pnpm hash authority rollback failed after persistence failure",
      { cause: primary },
    );
  }
}

export async function sha256File(absPath: string): Promise<string> {
  try {
    const buf = await fsp.readFile(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

export async function readVerifiedMarker(
  markerPath: string,
): Promise<PnpmStoreVerifiedMarker | null> {
  try {
    const raw = await fsp.readFile(markerPath, "utf8");
    const m = JSON.parse(raw) as Partial<PnpmStoreVerifiedMarker>;
    const importer = String(m.importer || "").trim();
    const lockfile = String(m.lockfile || "").trim();
    const lockHash = String(m.lockHash || "").trim();
    const hashValue = String(m.hashValue || "").trim();
    const builderFingerprint = String(m.builderFingerprint || "").trim();
    const derivationIdentity = String(m.derivationIdentity || "").trim();
    if (
      !importer ||
      !lockfile ||
      !lockHash ||
      !hashValue ||
      !builderFingerprint ||
      !/^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/.test(derivationIdentity)
    ) {
      return null;
    }
    return { importer, lockfile, lockHash, hashValue, builderFingerprint, derivationIdentity };
  } catch {
    return null;
  }
}

export async function readSharedHashCache(opts: {
  repoRoot: string;
  authorityDerivationIdentity: string;
  lockHash: string;
}): Promise<SharedPnpmStoreHashCacheEntry | null> {
  const cachePath = sharedHashCachePath(opts.authorityDerivationIdentity, opts.lockHash);
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    const entry = JSON.parse(raw) as Partial<SharedPnpmStoreHashCacheEntry>;
    const lockHash = String(entry.lockHash || "").trim();
    const hashValue = String(entry.hashValue || "").trim();
    const authorityDerivationIdentity = String(entry.authorityDerivationIdentity || "").trim();
    const finalDerivationIdentity = String(entry.finalDerivationIdentity || "").trim();
    if (
      !lockHash ||
      !hashValue ||
      !validDerivationIdentity(authorityDerivationIdentity) ||
      !validDerivationIdentity(finalDerivationIdentity) ||
      lockHash !== opts.lockHash ||
      authorityDerivationIdentity !== opts.authorityDerivationIdentity
    ) {
      return null;
    }
    return {
      lockHash,
      hashValue,
      authorityDerivationIdentity,
      finalDerivationIdentity,
    };
  } catch {
    return null;
  }
}

async function verifiedMarkerFingerprintForFiles(
  repoRoot: string,
  importer: string,
  files: readonly string[],
  opts: {
    includeImporterInputs?: boolean;
    includeImporterIdentity?: boolean;
    includeImporterPackageJson?: boolean;
  } = {},
): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(`platform=${process.platform}\n`);
  hash.update(`arch=${process.arch}\n`);
  for (const rel of files) {
    hash.update(`file=${rel}\n`);
    hash.update(await readFingerprintFile(repoRoot, rel));
    hash.update("\n");
  }
  if (opts.includeImporterInputs === false) {
    return hash.digest("hex");
  }
  const importerRoot = importer === "." ? "" : importer.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (opts.includeImporterIdentity !== false) {
    hash.update(`importer=${importerRoot || "."}\n`);
  }
  const importerInputFiles = [
    opts.includeImporterPackageJson === false
      ? null
      : importerRoot
        ? `${importerRoot}/package.json`
        : "package.json",
    importerRoot ? `${importerRoot}/.npmrc` : ".npmrc",
    importerRoot ? `${importerRoot}/pnpm-workspace.yaml` : "pnpm-workspace.yaml",
  ].filter((rel): rel is string => Boolean(rel));
  for (const rel of importerInputFiles) {
    hash.update(
      opts.includeImporterIdentity === false
        ? `importer-file=${path.basename(rel)}\n`
        : `importer-file=${rel}\n`,
    );
    try {
      hash.update(await fsp.readFile(path.join(repoRoot, rel), "utf8"));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function currentVerifiedMarkerFingerprint(
  repoRoot: string,
  importer = ".",
): Promise<string> {
  return await verifiedMarkerFingerprintForFiles(
    repoRoot,
    importer,
    pnpmStoreBuilderFingerprintFiles,
    { includeImporterInputs: true },
  );
}

export async function writeVerifiedMarker(
  markerPath: string,
  marker: PnpmStoreVerifiedMarker,
): Promise<void> {
  await mkdirWithMacosMetadataExclusion(path.dirname(markerPath)).catch(() => {});
  await fsp.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

export async function writeSharedHashCache(
  _repoRoot: string,
  entry: SharedPnpmStoreHashCacheEntry,
): Promise<void> {
  const cachePath = sharedHashCachePath(entry.authorityDerivationIdentity, entry.lockHash);
  const tmpPath = `${cachePath}.tmp-${process.pid}`;
  await mkdirWithMacosMetadataExclusion(path.dirname(cachePath)).catch(() => {});
  await fsp.writeFile(tmpPath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  await fsp.rename(tmpPath, cachePath);
}

export async function persistVerifiedHash(opts: {
  repoRoot: string;
  markerPath: string;
  marker: PnpmStoreVerifiedMarker;
  sharedAuthorityDerivationIdentities: string[];
  finalDerivationIdentity: string;
}): Promise<void> {
  const authorityDerivationIdentities = Array.from(
    new Set([...opts.sharedAuthorityDerivationIdentities, opts.finalDerivationIdentity]),
  );
  const cachePaths = authorityDerivationIdentities.map((authorityDerivationIdentity) =>
    sharedHashCachePath(authorityDerivationIdentity, opts.marker.lockHash),
  );
  const tmpPaths = cachePaths.map((cachePath) => `${cachePath}.tmp-${process.pid}`);
  const snapshots = await Promise.all(
    [opts.markerPath, ...cachePaths, ...tmpPaths].map(
      async (file) => await snapshotOwnedFile(file),
    ),
  );
  try {
    await writeVerifiedMarker(opts.markerPath, opts.marker);
    for (const authorityDerivationIdentity of authorityDerivationIdentities) {
      await writeSharedHashCache(opts.repoRoot, {
        lockHash: opts.marker.lockHash,
        hashValue: opts.marker.hashValue,
        authorityDerivationIdentity,
        finalDerivationIdentity: opts.finalDerivationIdentity,
      });
    }
  } catch (error) {
    await restoreOwnedFilesOrThrow(snapshots, error);
    throw error;
  }
}

export async function withSharedHashCacheLock<T>(
  opts: { repoRoot: string; authorityDerivationIdentity: string; lockHash: string },
  fn: () => Promise<T>,
): Promise<T> {
  const lockRoot = sharedPnpmStoreHashCacheRoot();
  const lockKey = `pnpm-store-hash:${opts.authorityDerivationIdentity}:${opts.lockHash}`;
  return await withExclusiveInstallLock(lockKey, fn, {
    timeoutMs: 45 * 60_000,
    staleMs: 45 * 60_000,
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockRoot,
  });
}

export async function restoreHashFromSharedCache(opts: {
  repoRoot: string;
  key: string;
  importer: string;
  storeAttr: string;
  authorityDerivationIdentity: string;
  existingLockHash: string;
  existingHash: string;
  hasValidExistingHash: boolean;
  hashOwner?: HashesJsonOwner;
  hashRoot?: string;
}): Promise<SharedPnpmStoreHashCacheEntry | null> {
  const sharedEntry = await readSharedHashCache({
    repoRoot: opts.repoRoot,
    authorityDerivationIdentity: opts.authorityDerivationIdentity,
    lockHash: opts.existingLockHash,
  });
  if (!sharedEntry) return null;
  if (!opts.hasValidExistingHash || sharedEntry.hashValue !== opts.existingHash) {
    await updateNodeModulesHashesJson(opts.key, sharedEntry.hashValue, {
      owner: opts.hashOwner,
      root: opts.hashRoot || opts.repoRoot,
    });
  }
  console.log(
    `[update-pnpm-hash] importer=${opts.importer} step=shared-hash-cache attr=${opts.storeAttr} lockfile=${opts.key}`,
  );
  return sharedEntry;
}
