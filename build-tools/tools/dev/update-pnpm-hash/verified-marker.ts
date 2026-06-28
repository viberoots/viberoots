import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { withExclusiveInstallLock } from "../install/lock";
import { updateNodeModulesHashesJson } from "./hashes-json";

export type PnpmStoreVerifiedMarker = {
  importer: string;
  lockfile: string;
  lockHash: string;
  hashValue: string;
  builderFingerprint: string;
};

export type SharedPnpmStoreHashCacheEntry = {
  lockHash: string;
  hashValue: string;
  builderFingerprint: string;
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
] as const;

const exactStoreProvisioningFingerprintFiles = [
  ...pnpmStoreBuilderFingerprintFiles,
  "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
  "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts",
  "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
  "viberoots/build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
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

function sharedCacheRepoRoot(repoRoot: string): string {
  const explicitRoot = String(process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT || "").trim();
  if (explicitRoot && path.isAbsolute(explicitRoot)) {
    return path.resolve(explicitRoot);
  }
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || "").trim();
  if (workspaceRoot && path.isAbsolute(workspaceRoot)) {
    return path.resolve(workspaceRoot);
  }
  const liveRoot = String(process.env.REPO_ROOT || "").trim();
  if (liveRoot && path.isAbsolute(liveRoot)) {
    return path.resolve(liveRoot);
  }
  return repoRoot;
}

function sharedHashCachePath(
  repoRoot: string,
  builderFingerprint: string,
  lockHash: string,
): string {
  return path.join(
    sharedCacheRepoRoot(repoRoot),
    ".viberoots",
    "workspace",
    "buck",
    "pnpm-store-hash-cache",
    builderFingerprint,
    `${lockHash}.json`,
  );
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
    if (!importer || !lockfile || !lockHash || !hashValue || !builderFingerprint) return null;
    return { importer, lockfile, lockHash, hashValue, builderFingerprint };
  } catch {
    return null;
  }
}

export async function readSharedHashCache(opts: {
  repoRoot: string;
  builderFingerprint: string;
  lockHash: string;
}): Promise<string | null> {
  const cachePath = sharedHashCachePath(opts.repoRoot, opts.builderFingerprint, opts.lockHash);
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    const entry = JSON.parse(raw) as Partial<SharedPnpmStoreHashCacheEntry>;
    const lockHash = String(entry.lockHash || "").trim();
    const hashValue = String(entry.hashValue || "").trim();
    const builderFingerprint = String(entry.builderFingerprint || "").trim();
    if (
      !lockHash ||
      !hashValue ||
      !builderFingerprint ||
      lockHash !== opts.lockHash ||
      builderFingerprint !== opts.builderFingerprint
    ) {
      return null;
    }
    return hashValue;
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

export async function currentSharedPnpmStoreHashCacheFingerprint(
  repoRoot: string,
  importer = ".",
): Promise<string> {
  return await verifiedMarkerFingerprintForFiles(
    repoRoot,
    importer,
    exactStoreProvisioningFingerprintFiles,
    {
      includeImporterIdentity: false,
      includeImporterPackageJson: false,
    },
  );
}

export async function currentVerifiedMarkerFingerprintCandidates(
  repoRoot: string,
  importer = ".",
): Promise<string[]> {
  const current = await currentVerifiedMarkerFingerprint(repoRoot, importer);
  const exactStoreProvisioning = await verifiedMarkerFingerprintForFiles(
    repoRoot,
    importer,
    exactStoreProvisioningFingerprintFiles,
    { includeImporterInputs: true },
  );
  return Array.from(new Set([current, exactStoreProvisioning]));
}

export async function writeVerifiedMarker(
  markerPath: string,
  marker: PnpmStoreVerifiedMarker,
): Promise<void> {
  await mkdirWithMacosMetadataExclusion(path.dirname(markerPath)).catch(() => {});
  await fsp.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

export async function writeSharedHashCache(
  repoRoot: string,
  entry: SharedPnpmStoreHashCacheEntry,
): Promise<void> {
  const cachePath = sharedHashCachePath(repoRoot, entry.builderFingerprint, entry.lockHash);
  const tmpPath = `${cachePath}.tmp-${process.pid}`;
  await mkdirWithMacosMetadataExclusion(path.dirname(cachePath)).catch(() => {});
  await fsp.writeFile(tmpPath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  await fsp.rename(tmpPath, cachePath);
}

export async function persistVerifiedHash(opts: {
  repoRoot: string;
  markerPath: string;
  marker: PnpmStoreVerifiedMarker;
  sharedCacheBuilderFingerprint?: string;
}): Promise<void> {
  await writeVerifiedMarker(opts.markerPath, opts.marker);
  await writeSharedHashCache(opts.repoRoot, {
    lockHash: opts.marker.lockHash,
    hashValue: opts.marker.hashValue,
    builderFingerprint: opts.sharedCacheBuilderFingerprint || opts.marker.builderFingerprint,
  });
}

export async function withSharedHashCacheLock<T>(
  opts: { repoRoot: string; builderFingerprint: string; lockHash: string },
  fn: () => Promise<T>,
): Promise<T> {
  const lockRoot = sharedCacheRepoRoot(opts.repoRoot);
  const lockKey = `pnpm-store-hash:${opts.builderFingerprint}:${opts.lockHash}`;
  return await withExclusiveInstallLock(lockKey, fn, {
    timeoutMs: 15 * 60_000,
    staleMs: 15 * 60_000,
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockRoot,
  });
}

export async function restoreHashFromSharedCache(opts: {
  repoRoot: string;
  key: string;
  markerPath: string;
  importer: string;
  storeAttr: string;
  builderFingerprint: string;
  sharedCacheBuilderFingerprint?: string;
  existingLockHash: string;
  existingHash: string;
  hasValidExistingHash: boolean;
}): Promise<boolean> {
  const sharedHash = await readSharedHashCache({
    repoRoot: opts.repoRoot,
    builderFingerprint: opts.sharedCacheBuilderFingerprint || opts.builderFingerprint,
    lockHash: opts.existingLockHash,
  });
  if (!sharedHash) return false;
  if (!opts.hasValidExistingHash || sharedHash !== opts.existingHash) {
    await updateNodeModulesHashesJson(opts.key, sharedHash);
  }
  await persistVerifiedHash({
    repoRoot: opts.repoRoot,
    markerPath: opts.markerPath,
    marker: {
      importer: opts.importer,
      lockfile: opts.key,
      lockHash: opts.existingLockHash,
      hashValue: sharedHash,
      builderFingerprint: opts.builderFingerprint,
    },
    sharedCacheBuilderFingerprint: opts.sharedCacheBuilderFingerprint,
  });
  console.log(
    `[update-pnpm-hash] importer=${opts.importer} step=shared-hash-cache attr=${opts.storeAttr} lockfile=${opts.key}`,
  );
  return true;
}
