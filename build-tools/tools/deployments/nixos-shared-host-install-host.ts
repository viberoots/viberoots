#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeJsonDocument } from "./nixos-shared-host-io";
import {
  installManagedConfigEntry,
  renderConfigEntryInstruction,
  uninstallManagedConfigEntry,
} from "./nixos-shared-host-install-config-entry";
import {
  createEmptyPlatformStateJson,
  createInstallManifestV1,
  defaultManagedRoot,
  defaultRecordsRoot,
  defaultRuntimeRoot,
  defaultStatePath,
  hostPath,
  manifestPathFor,
  type NixosSharedHostConfigTopology,
  type NixosSharedHostInstallManifestV1,
  type NixosSharedHostInstallMode,
  type NixosSharedHostWiringState,
  renderManagedAnchor,
  renderManagedModule,
} from "./nixos-shared-host-install-contract";
import {
  assertUninstallInventoryIsConfigOnly,
  detectConfigTopology,
  detectWiringState,
  ensureWritable,
  manifestInstallDirectories,
  mkdirHostDirectories,
  pathExists,
  readManifestIfPresent,
  readText,
  removeManagedInstallPaths,
} from "./nixos-shared-host-install-host-support";

export async function installNixosSharedHost(opts: {
  hostRoot: string;
  configRoot: string;
  configTopology?: NixosSharedHostConfigTopology;
  configEntryPath?: string;
  managedRoot?: string;
  statePath?: string;
  runtimeRoot?: string;
  recordsRoot?: string;
  installMode: NixosSharedHostInstallMode;
  toolFingerprint: string;
  dryRun?: boolean;
}): Promise<{
  manifest: NixosSharedHostInstallManifestV1;
  manifestPath: string;
  wiringState: NixosSharedHostWiringState;
  configInstruction: string;
  emittedSnippets: {
    managedModulePath: string;
    managedModuleSource: string;
    managedAnchorPath: string;
    managedAnchorSource: string;
  };
}> {
  const configRoot = opts.configRoot;
  const managedRoot = opts.managedRoot || defaultManagedRoot(configRoot);
  if (opts.installMode === "managed-dropin" && !opts.configEntryPath) {
    throw new Error("managed-dropin requires explicit --config-entry-path");
  }
  const manifest = createInstallManifestV1({
    toolFingerprint: opts.toolFingerprint,
    installMode: opts.installMode,
    configTopology: opts.configTopology || (await detectConfigTopology(opts.hostRoot, configRoot)),
    configRoot,
    configEntryPath: opts.configEntryPath,
    configInjected: opts.installMode === "managed-dropin",
    managedRoot,
    statePath: opts.statePath || defaultStatePath(managedRoot),
    runtimeRoot: opts.runtimeRoot || defaultRuntimeRoot(),
    recordsRoot: opts.recordsRoot || defaultRecordsRoot(),
  });
  const manifestPath = manifestPathFor(managedRoot);
  const existing = await readManifestIfPresent(opts.hostRoot, manifestPath);
  const osReleasePath = hostPath(opts.hostRoot, "/etc/os-release");
  if (!(await pathExists(osReleasePath)) || !(await readText(osReleasePath)).includes("ID=nixos")) {
    throw new Error("host preflight failed: expected a NixOS /etc/os-release");
  }
  const nixConfPath = hostPath(opts.hostRoot, "/etc/nix/nix.conf");
  const nixConf = (await pathExists(nixConfPath)) ? await readText(nixConfPath) : "";
  if (!nixConf.includes("nix-command") || !nixConf.includes("flakes")) {
    throw new Error("host preflight failed: /etc/nix/nix.conf must enable nix-command and flakes");
  }
  for (const logicalPath of [
    ...manifest.managedPaths,
    ...manifest.managedDirectories,
    manifest.statePath,
    manifest.runtimeRoot,
    manifest.recordsRoot,
  ]) {
    await ensureWritable(hostPath(opts.hostRoot, logicalPath));
  }
  if (existing && existing.managedRoot !== manifest.managedRoot) {
    throw new Error(
      `host preflight failed: existing managed root ${existing.managedRoot} conflicts with ${manifest.managedRoot}`,
    );
  }
  if (!existing) {
    for (const logicalPath of [
      manifest.managedEntryPoints.modulePath,
      manifest.managedEntryPoints.anchorPath,
      manifestPath,
    ]) {
      if (await pathExists(hostPath(opts.hostRoot, logicalPath))) {
        throw new Error(
          `host preflight failed: ${logicalPath} already exists without a managed install manifest`,
        );
      }
    }
  }
  const configInstruction = renderConfigEntryInstruction({
    topology: manifest.configTopology,
    anchorPath: manifest.managedEntryPoints.anchorPath,
  });
  const managedModuleSource = renderManagedModule({
    managedRoot: manifest.managedRoot,
    statePath: manifest.statePath,
  });
  const managedAnchorSource = renderManagedAnchor(managedRoot);
  const writes = [
    [manifest.managedEntryPoints.modulePath, managedModuleSource],
    [manifest.managedEntryPoints.anchorPath, managedAnchorSource],
    [manifestPath, JSON.stringify(manifest, null, 2) + "\n"],
    ...(opts.installMode === "managed-dropin" || opts.installMode === "managed-manual-wire"
      ? [[manifest.statePath, createEmptyPlatformStateJson()]]
      : []),
  ] as Array<[string, string]>;
  if (!opts.dryRun) {
    if (opts.installMode === "managed-dropin") {
      await mkdirHostDirectories(opts.hostRoot, manifestInstallDirectories(manifest));
      for (const [logicalPath, content] of writes) {
        const physical = hostPath(opts.hostRoot, logicalPath);
        await fsp.mkdir(path.dirname(physical), { recursive: true });
        if (logicalPath === manifestPath) await writeJsonDocument(physical, manifest);
        else if (!(await pathExists(physical))) {
          await fsp.writeFile(physical, content, "utf8");
        } else if (logicalPath !== manifest.statePath) {
          await fsp.writeFile(physical, content, "utf8");
        }
      }
      const configEntryPath = hostPath(opts.hostRoot, manifest.configInjection!.path);
      const updated = installManagedConfigEntry({
        source: await readText(configEntryPath),
        topology: manifest.configTopology,
        anchorPath: manifest.managedEntryPoints.anchorPath,
      });
      await fsp.writeFile(configEntryPath, updated, "utf8");
    } else if (opts.installMode === "managed-manual-wire") {
      if (existing) {
        throw new Error(
          "managed-manual-wire refuses to reuse an existing managed install; use status or uninstall",
        );
      }
      await mkdirHostDirectories(opts.hostRoot, manifestInstallDirectories(manifest));
      for (const [logicalPath, content] of writes) {
        const physical = hostPath(opts.hostRoot, logicalPath);
        await fsp.mkdir(path.dirname(physical), { recursive: true });
        if (logicalPath === manifestPath) await writeJsonDocument(physical, manifest);
        else if (logicalPath === manifest.statePath && (await pathExists(physical))) continue;
        else await fsp.writeFile(physical, content, "utf8");
      }
    } else if (existing) {
      throw new Error(
        "emit-only refuses to reuse an existing managed install; use status or uninstall",
      );
    } else {
      for (const logicalPath of [
        manifest.managedEntryPoints.modulePath,
        manifest.managedEntryPoints.anchorPath,
      ]) {
        if (await pathExists(hostPath(opts.hostRoot, logicalPath))) {
          throw new Error(`emit-only refused because managed path already exists: ${logicalPath}`);
        }
      }
    }
  }
  return {
    manifest,
    manifestPath,
    wiringState:
      opts.installMode === "managed-dropin"
        ? await detectWiringState(opts.hostRoot, manifest)
        : "missing",
    configInstruction,
    emittedSnippets: {
      managedModulePath: manifest.managedEntryPoints.modulePath,
      managedModuleSource,
      managedAnchorPath: manifest.managedEntryPoints.anchorPath,
      managedAnchorSource,
    },
  };
}

export async function uninstallNixosSharedHost(opts: {
  hostRoot: string;
  manifestPath: string;
  dryRun?: boolean;
}): Promise<{ manifest: NixosSharedHostInstallManifestV1; removedPaths: string[] }> {
  const manifest = await readManifestIfPresent(opts.hostRoot, opts.manifestPath);
  if (!manifest) throw new Error(`managed install manifest not found: ${opts.manifestPath}`);
  assertUninstallInventoryIsConfigOnly(manifest);
  if (!opts.dryRun && manifest.configInjection?.path) {
    const configEntryPath = hostPath(opts.hostRoot, manifest.configInjection.path);
    if (await pathExists(configEntryPath)) {
      await fsp.writeFile(
        configEntryPath,
        uninstallManagedConfigEntry(await readText(configEntryPath)),
        "utf8",
      );
    }
  }
  const removedPaths = [...manifest.managedPaths, ...manifest.managedDirectories].sort().reverse();
  if (!opts.dryRun) {
    await removeManagedInstallPaths(opts.hostRoot, manifest);
  }
  return { manifest, removedPaths };
}

export async function statusNixosSharedHost(opts: {
  hostRoot: string;
  manifestPath: string;
}): Promise<{
  managed: boolean;
  manifest?: NixosSharedHostInstallManifestV1;
  wiringState?: NixosSharedHostWiringState;
  existingManagedPaths?: string[];
}> {
  const manifest = await readManifestIfPresent(opts.hostRoot, opts.manifestPath);
  if (!manifest) return { managed: false };
  const existingManagedPaths: string[] = [];
  for (const logicalPath of [...manifest.managedPaths, ...manifest.managedDirectories]) {
    if (await pathExists(hostPath(opts.hostRoot, logicalPath)))
      existingManagedPaths.push(logicalPath);
  }
  return {
    managed: true,
    manifest,
    wiringState: await detectWiringState(opts.hostRoot, manifest),
    existingManagedPaths: existingManagedPaths.sort(),
  };
}
