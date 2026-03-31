import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { updateNodeModulesHashesJson } from "./hashes-json.ts";

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
  "flake.lock",
  "build-tools/tools/nix/flake/for-all-systems.nix",
  "build-tools/tools/nix/flake/per-system-context.nix",
  "build-tools/tools/nix/flake/packages/default.nix",
  "build-tools/tools/nix/flake/packages/node-mods.nix",
  "build-tools/tools/nix/node-modules.nix",
  "build-tools/tools/nix/node-modules/common.nix",
  "build-tools/tools/nix/node-modules/store.nix",
  "build-tools/tools/nix/node-modules/modules.nix",
] as const;

export function verifiedMarkerPath(repoRoot: string, importer: string): string {
  const key =
    importer === "." ? "root" : importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(repoRoot, "buck-out", "tmp", `pnpm-store-verified.${key}.json`);
}

function sharedCacheRepoRoot(repoRoot: string): string {
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
    "buck-out",
    ".pnpm-store-hash-cache",
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

export async function currentVerifiedMarkerFingerprint(repoRoot: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(`platform=${process.platform}\n`);
  hash.update(`arch=${process.arch}\n`);
  for (const rel of pnpmStoreBuilderFingerprintFiles) {
    hash.update(`file=${rel}\n`);
    try {
      hash.update(await fsp.readFile(path.join(repoRoot, rel), "utf8"));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function writeVerifiedMarker(
  markerPath: string,
  marker: PnpmStoreVerifiedMarker,
): Promise<void> {
  await fsp.mkdir(path.dirname(markerPath), { recursive: true }).catch(() => {});
  await fsp.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

export async function writeSharedHashCache(
  repoRoot: string,
  entry: SharedPnpmStoreHashCacheEntry,
): Promise<void> {
  const cachePath = sharedHashCachePath(repoRoot, entry.builderFingerprint, entry.lockHash);
  const tmpPath = `${cachePath}.tmp-${process.pid}`;
  await fsp.mkdir(path.dirname(cachePath), { recursive: true }).catch(() => {});
  await fsp.writeFile(tmpPath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  await fsp.rename(tmpPath, cachePath);
}

export async function persistVerifiedHash(opts: {
  repoRoot: string;
  markerPath: string;
  marker: PnpmStoreVerifiedMarker;
}): Promise<void> {
  await writeVerifiedMarker(opts.markerPath, opts.marker);
  await writeSharedHashCache(opts.repoRoot, {
    lockHash: opts.marker.lockHash,
    hashValue: opts.marker.hashValue,
    builderFingerprint: opts.marker.builderFingerprint,
  });
}

export async function restoreHashFromSharedCache(opts: {
  repoRoot: string;
  key: string;
  markerPath: string;
  importer: string;
  storeAttr: string;
  builderFingerprint: string;
  existingLockHash: string;
  existingHash: string;
  hasValidExistingHash: boolean;
}): Promise<boolean> {
  const sharedHash = await readSharedHashCache({
    repoRoot: opts.repoRoot,
    builderFingerprint: opts.builderFingerprint,
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
  });
  console.log(
    `[update-pnpm-hash] importer=${opts.importer} step=shared-hash-cache attr=${opts.storeAttr} lockfile=${opts.key}`,
  );
  return true;
}
