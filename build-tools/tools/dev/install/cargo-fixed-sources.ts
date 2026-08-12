import * as fsp from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { cargoPackageKey, readCargoPackages } from "../../patch/rust-lock";
import { emitTimingDetail } from "../../lib/timing-detail";
import { verifiedGitSourceCopy } from "./cargo-git-integrity";
import { verifiedRegistrySourceCopy } from "./cargo-registry-integrity";
import {
  forEachFixedSourceMaterialization,
  type DeferredFixedSourceMaterialization,
} from "./cargo-fixed-source-materialization";

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
  cargoHome?: string,
  deferredMaterialization?: DeferredFixedSourceMaterialization,
): Promise<FixedSourceMap> {
  const result: FixedSourceMap = {};
  const deferred: Array<{
    index: number;
    key: string;
    entry: FixedSourceEntry;
    storePath: string;
  }> = [];
  let verifiedCopyMs = 0;
  let immutableMaterializationMs = 0;
  let materializedCount = 0;
  let reusedCount = 0;
  const entries = Object.entries(sources).map(([key, entry], index) => ({ index, key, entry }));
  for (const { key, entry } of entries) result[key] = entry;
  const materializeEntry = async ({
    index,
    key,
    entry,
  }: {
    index: number;
    key: string;
    entry: FixedSourceEntry;
  }): Promise<void> => {
    if (!entry.source.startsWith("registry+") && !entry.source.startsWith("git+")) {
      return;
    }
    const cached = await deferredMaterialization?.lookup?.(key, entry);
    if (cached) {
      result[key] = {
        ...entry,
        ...cached,
        buildInput: {
          source: entry.source,
          checksum: entry.checksum,
          ...cached,
        },
      };
      reusedCount += 1;
      return;
    }
    const verifiedStarted = performance.now();
    const verified = await (entry.source.startsWith("registry+")
      ? verifiedRegistrySourceCopy(
          entry.originPath,
          key,
          entry.source,
          entry.checksum,
          runGit,
          cargoHome,
        )
      : runGit
        ? verifiedGitSourceCopy(entry.originPath, key, entry.source, runGit)
        : (() => {
            throw new Error(`Cargo Git materialization command authority is unavailable: ${key}`);
          })());
    verifiedCopyMs += performance.now() - verifiedStarted;
    try {
      const materializationStarted = performance.now();
      if (deferredMaterialization) {
        const immutable = await deferredMaterialization.add(key, {
          ...entry,
          originPath: verified.root,
        });
        deferred.push({ index, key, entry, storePath: immutable.storePath });
        // Establish the original source order before replacing this placeholder
        // after the single batch hash operation.
        result[key] = entry;
      } else {
        const immutable = await materialize(key, { ...entry, originPath: verified.root });
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
      immutableMaterializationMs += performance.now() - materializationStarted;
      materializedCount += 1;
    } finally {
      await verified.cleanup();
    }
  };
  if (deferredMaterialization) {
    await forEachFixedSourceMaterialization(entries, materializeEntry);
  } else {
    for (const entry of entries) await materializeEntry(entry);
  }
  if (deferred.length > 0) {
    deferred.sort((left, right) => left.index - right.index);
    const materializationStarted = performance.now();
    const hashes = await deferredMaterialization!.hash(deferred.map((entry) => entry.storePath));
    immutableMaterializationMs += performance.now() - materializationStarted;
    if (hashes.length !== deferred.length) {
      throw new Error(
        `Cargo fixed-source batch hash returned ${hashes.length} hashes for ${deferred.length} paths`,
      );
    }
    for (const [index, pending] of deferred.entries()) {
      const narHash = hashes[index] || "";
      if (!narHash.startsWith("sha256-")) {
        throw new Error(`Cargo fixed-source batch hash is invalid: ${pending.key}`);
      }
      const immutable = { storePath: pending.storePath, narHash };
      result[pending.key] = {
        ...pending.entry,
        ...immutable,
        buildInput: {
          source: pending.entry.source,
          checksum: pending.entry.checksum,
          ...immutable,
        },
      };
      await deferredMaterialization!.store?.(pending.key, pending.entry, immutable);
    }
  }
  emitTimingDetail(`Rust fixed sources cache reuse total (${reusedCount} sources)`, 0);
  emitTimingDetail(
    `Rust fixed sources verified copy total (${materializedCount} sources)`,
    verifiedCopyMs,
  );
  emitTimingDetail(
    `Rust fixed sources immutable materialization total (${materializedCount} sources)`,
    immutableMaterializationMs,
  );
  return result;
}
