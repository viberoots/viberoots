import * as fsp from "node:fs/promises";
import path from "node:path";
import { cargoPackageKey, readCargoPackages } from "../../patch/rust-lock";
import { verifiedGitSourceCopy } from "./cargo-git-integrity";
import { verifiedRegistrySourceCopy } from "./cargo-registry-integrity";

export type FixedSourceEntry = {
  originPath: string;
  source: string;
  checksum: string;
  storePath?: string;
  narHash?: string;
  registryName?: string;
  buildInput?: {
    source: string;
    checksum: string;
    storePath: string;
    narHash: string;
  };
};

export type FixedSourceMap = Record<string, FixedSourceEntry>;

export async function fixedSourcesFromCargoMetadata(
  metadataJSON: string,
  lockFile: string,
): Promise<FixedSourceMap> {
  const metadata = JSON.parse(metadataJSON || "{}") as {
    packages?: Array<{
      name?: string;
      version?: string;
      source?: string | null;
      manifest_path?: string;
    }>;
  };
  const lockPackages = await readCargoPackages(lockFile);
  const lockByKey = new Map(lockPackages.map((pkg) => [cargoPackageKey(pkg), pkg]));
  const fixedSources: FixedSourceMap = {};
  for (const pkg of metadata.packages || []) {
    if (!pkg.source || !pkg.name || !pkg.version || !pkg.manifest_path) continue;
    const key = `${pkg.name.toLowerCase()}@${pkg.version}#${pkg.source}`;
    const locked = lockByKey.get(key);
    if (!locked) throw new Error(`Cargo metadata source is absent from Cargo.lock: ${key}`);
    fixedSources[key] = {
      originPath: await fsp.realpath(path.dirname(pkg.manifest_path)),
      source: pkg.source,
      checksum: locked.checksum,
    };
  }
  return fixedSources;
}

export function mergeFixedSourceMaps(maps: FixedSourceMap[]): FixedSourceMap {
  const merged: FixedSourceMap = {};
  for (const map of maps) {
    for (const [key, source] of Object.entries(map)) {
      const existing = merged[key];
      if (existing && JSON.stringify(existing) !== JSON.stringify(source)) {
        throw new Error(`Cargo fixed-source identity resolved inconsistently: ${key}`);
      }
      merged[key] = source;
    }
  }
  return merged;
}

export async function materializeFixedSources(
  sources: FixedSourceMap,
  materialize: (
    key: string,
    entry: FixedSourceEntry,
  ) => Promise<{
    storePath: string;
    narHash: string;
  }>,
  runGit?: (command: string, args: string[], cwd: string) => Promise<string>,
): Promise<FixedSourceMap> {
  const result: FixedSourceMap = {};
  for (const [key, entry] of Object.entries(sources)) {
    if (!entry.source.startsWith("registry+") && !entry.source.startsWith("git+")) {
      result[key] = entry;
      continue;
    }
    const verified = entry.source.startsWith("registry+")
      ? await verifiedRegistrySourceCopy(entry.originPath, key, entry.source, entry.checksum)
      : runGit
        ? await verifiedGitSourceCopy(entry.originPath, key, entry.source, runGit)
        : (() => {
            throw new Error(`Cargo Git materialization command authority is unavailable: ${key}`);
          })();
    let immutable: { storePath: string; narHash: string };
    try {
      immutable = await materialize(key, { ...entry, originPath: verified.root });
    } finally {
      await verified.cleanup();
    }
    result[key] = {
      ...entry,
      ...immutable,
      buildInput: {
        source: entry.source,
        checksum: entry.checksum,
        ...immutable,
      },
    };
  }
  return result;
}

export function fixedSourceManifestPath(root: string): string {
  return path.join(root, ".viberoots/workspace/cargo-home/viberoots-fixed-sources.json");
}

export async function fixedSourceManifestMatches(
  root: string,
  expected: FixedSourceMap,
): Promise<boolean> {
  const file = fixedSourceManifestPath(root);
  const actual = await fsp
    .readFile(file, "utf8")
    .then((bytes) => JSON.parse(bytes) as FixedSourceMap)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
    return false;
  }
  for (const [key, entry] of Object.entries(expected)) {
    const reviewed = actual[key];
    if (
      !reviewed ||
      reviewed.originPath !== entry.originPath ||
      reviewed.source !== entry.source ||
      reviewed.checksum !== entry.checksum
    ) {
      return false;
    }
    if (
      (entry.source.startsWith("registry+") || entry.source.startsWith("git+")) &&
      (!reviewed.storePath?.startsWith("/nix/store/") || !reviewed.narHash?.startsWith("sha256-"))
    ) {
      return false;
    }
    if (
      (entry.source.startsWith("registry+") || entry.source.startsWith("git+")) &&
      (!reviewed.buildInput ||
        reviewed.buildInput.source !== entry.source ||
        reviewed.buildInput.checksum !== entry.checksum ||
        reviewed.buildInput.storePath !== reviewed.storePath ||
        reviewed.buildInput.narHash !== reviewed.narHash)
    ) {
      return false;
    }
  }
  return true;
}
