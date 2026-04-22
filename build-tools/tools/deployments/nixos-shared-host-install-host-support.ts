#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { configEntryContainsManagedAnchorVariant } from "./nixos-shared-host-install-config-entry.ts";
import {
  hostPath,
  normalizeHostLogicalPath,
  readInstallManifest,
  type NixosSharedHostConfigTopology,
  type NixosSharedHostInstallManifestV1,
  type NixosSharedHostWiringState,
} from "./nixos-shared-host-install-contract.ts";

export function manifestDataDirectories(manifest: NixosSharedHostInstallManifestV1): string[] {
  return Array.from(
    new Set([path.posix.dirname(manifest.statePath), manifest.runtimeRoot, manifest.recordsRoot]),
  );
}

export function manifestInstallDirectories(manifest: NixosSharedHostInstallManifestV1): string[] {
  return Array.from(
    new Set([...manifest.managedDirectories, ...manifestDataDirectories(manifest)]),
  );
}

export async function mkdirHostDirectories(hostRoot: string, logicalDirs: string[]): Promise<void> {
  for (const logicalDir of logicalDirs) {
    await fsp.mkdir(hostPath(hostRoot, logicalDir), { recursive: true });
  }
}

export async function removeManagedInstallPaths(
  hostRoot: string,
  manifest: NixosSharedHostInstallManifestV1,
): Promise<void> {
  for (const logicalPath of [...manifest.managedPaths].sort().reverse()) {
    await fsp.rm(hostPath(hostRoot, logicalPath), { force: true });
  }
  for (const logicalPath of [...manifest.managedDirectories].sort().reverse()) {
    try {
      await fsp.rmdir(hostPath(hostRoot, logicalPath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || "";
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(code)) throw error;
    }
  }
}

export function assertUninstallInventoryIsConfigOnly(
  manifest: NixosSharedHostInstallManifestV1,
): void {
  const managedRoot = normalizeHostLogicalPath(manifest.managedRoot);
  const managedRootPrefix = managedRoot.endsWith("/") ? managedRoot : `${managedRoot}/`;
  for (const logicalPath of [...manifest.managedPaths, ...manifest.managedDirectories]) {
    const normalized = normalizeHostLogicalPath(logicalPath);
    if (normalized !== managedRoot && !normalized.startsWith(managedRootPrefix)) {
      throw new Error(
        `refusing to uninstall path outside managed config root: ${logicalPath} is not under ${managedRoot}`,
      );
    }
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath: string): Promise<string> {
  return await fsp.readFile(filePath, "utf8");
}

export async function ensureWritable(targetPath: string): Promise<void> {
  let current = path.dirname(targetPath);
  for (;;) {
    if (await pathExists(current)) {
      await fsp.access(current, fs.constants.W_OK);
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`host preflight failed: no writable parent exists for ${targetPath}`);
}

export async function detectConfigTopology(
  hostRoot: string,
  configRoot: string,
): Promise<NixosSharedHostConfigTopology> {
  if (await pathExists(hostPath(hostRoot, path.posix.join(configRoot, "flake.nix"))))
    return "flake";
  if (await pathExists(hostPath(hostRoot, path.posix.join(configRoot, "configuration.nix"))))
    return "plain";
  throw new Error(
    `${configRoot}: unable to detect host config topology (expected flake.nix or configuration.nix)`,
  );
}

export async function detectDefaultConfigEntryPath(
  hostRoot: string,
  configRoot: string,
): Promise<string> {
  const root = normalizeHostLogicalPath(configRoot);
  const flakeEntry = path.posix.join(root, "flake.nix");
  if (await pathExists(hostPath(hostRoot, flakeEntry))) return flakeEntry;
  const plainEntry = path.posix.join(root, "configuration.nix");
  if (await pathExists(hostPath(hostRoot, plainEntry))) return plainEntry;
  throw new Error(
    `${root}: unable to detect config entry path (expected flake.nix or configuration.nix)`,
  );
}

export async function detectWiringState(
  hostRoot: string,
  manifest: NixosSharedHostInstallManifestV1,
): Promise<NixosSharedHostWiringState> {
  const logicalEntryPath = manifest.configInjection?.path || manifest.configEntryPath;
  if (!logicalEntryPath) return "unknown";
  const entryPath = hostPath(hostRoot, logicalEntryPath);
  if (!(await pathExists(entryPath))) return "missing";
  const entryDir = path.posix.dirname(normalizeHostLogicalPath(logicalEntryPath));
  const relativeAnchor = `./${path.posix.relative(
    entryDir,
    normalizeHostLogicalPath(manifest.managedEntryPoints.anchorPath),
  )}`;
  return configEntryContainsManagedAnchorVariant(
    await readText(entryPath),
    manifest.managedEntryPoints.anchorPath,
    [relativeAnchor],
  )
    ? "wired"
    : "missing";
}

export async function readManifestIfPresent(
  hostRoot: string,
  manifestPath: string,
): Promise<NixosSharedHostInstallManifestV1 | null> {
  const physicalPath = hostPath(hostRoot, manifestPath);
  if (!(await pathExists(physicalPath))) return null;
  return await readInstallManifest(physicalPath);
}
