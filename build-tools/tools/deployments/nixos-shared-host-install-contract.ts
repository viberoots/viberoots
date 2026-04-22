#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { emptyNixosSharedHostPlatformState } from "./nixos-shared-host-platform.ts";

export const NIXOS_SHARED_HOST_INSTALL_SCHEMA_V1 = "nixos-shared-host-install@1";
export const NIXOS_SHARED_HOST_INSTALL_SCHEMA_V0 = "nixos-shared-host-install@0";
export const NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1 = "nixos-shared-host-client@1";
export const NIXOS_SHARED_HOST_INSTALL_TOOL = "nixos-shared-host-install";

export type NixosSharedHostInstallMode = "emit-only" | "managed-manual-wire" | "managed-dropin";
export type NixosSharedHostConfigTopology = "flake" | "plain";
export type NixosSharedHostWiringState = "wired" | "missing" | "unknown";

export type NixosSharedHostInstallManifestV1 = {
  schemaVersion: typeof NIXOS_SHARED_HOST_INSTALL_SCHEMA_V1;
  tool: typeof NIXOS_SHARED_HOST_INSTALL_TOOL;
  toolFingerprint: string;
  installMode: NixosSharedHostInstallMode;
  configTopology: NixosSharedHostConfigTopology;
  configRoot: string;
  configEntryPath?: string;
  managedRoot: string;
  statePath: string;
  runtimeRoot: string;
  recordsRoot: string;
  managedPaths: string[];
  managedDirectories: string[];
  managedUsers: string[];
  managedEntryPoints: {
    modulePath: string;
    anchorPath: string;
  };
  configInjection?: {
    path: string;
  };
};

type NixosSharedHostInstallManifestV0 = {
  schemaVersion: typeof NIXOS_SHARED_HOST_INSTALL_SCHEMA_V0;
  installMode: NixosSharedHostInstallMode;
  configRoot: string;
  managedRoot: string;
  statePath: string;
  runtimeRoot: string;
  recordsRoot: string;
  dropInPath: string;
  anchorPath: string;
  managedPaths?: string[];
};

export type NixosSharedHostClientManifest = {
  schemaVersion: typeof NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1;
  tool: typeof NIXOS_SHARED_HOST_INSTALL_TOOL;
  toolFingerprint: string;
  profileName: string;
  destination: string;
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  sshMode: string;
  serviceClient: {
    controlPlaneUrl: string;
    controlPlaneTokenEnv?: string;
  };
  localManagedPaths: string[];
};

export function normalizeHostLogicalPath(value: string): string {
  const normalized = path.posix.normalize(value.trim() || "/");
  if (!normalized.startsWith("/")) throw new Error(`expected absolute host path, got "${value}"`);
  return normalized;
}

export function hostPath(hostRoot: string, logicalPath: string): string {
  const root = path.resolve(hostRoot || "/");
  const logical = normalizeHostLogicalPath(logicalPath);
  return root === "/" ? logical : path.join(root, logical.slice(1));
}

export function defaultManagedRoot(configRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(configRoot), "nixos-shared-host");
}

export function defaultStatePath(): string {
  return "/var/lib/nixos-shared-host/platform-state.json";
}

export function defaultRuntimeRoot(): string {
  return "/var/lib/nixos-shared-host/runtime";
}

export function defaultRecordsRoot(): string {
  return "/var/lib/nixos-shared-host/records";
}

export function legacyDefaultManagedRoot(configRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(configRoot), "bucknix", "nixos-shared-host");
}

function legacyDefaultStatePath(): string {
  return "/var/lib/bucknix/nixos-shared-host/platform-state.json";
}

function legacyDefaultRuntimeRoot(): string {
  return "/var/lib/bucknix/nixos-shared-host/runtime";
}

function legacyDefaultRecordsRoot(): string {
  return "/var/lib/bucknix/nixos-shared-host/records";
}

export function manifestPathFor(managedRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(managedRoot), "install-manifest.json");
}

export function modulePathFor(managedRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(managedRoot), "nixos-shared-host-managed.nix");
}

export function anchorPathFor(managedRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(managedRoot), "default.nix");
}

export function createEmptyPlatformStateJson(): string {
  return JSON.stringify(emptyNixosSharedHostPlatformState(), null, 2) + "\n";
}

export function renderManagedModule(opts: { repoRoot: string; statePath: string }): string {
  const moduleSource = path.posix.join(
    opts.repoRoot.replace(/\\/g, "/"),
    "build-tools/tools/nix/nixos-shared-host-module.nix",
  );
  return [
    "{ ... }:",
    "{",
    "  imports = [",
    `    ${moduleSource}`,
    "  ];",
    "",
    "  nixosSharedHost.enable = true;",
    `  nixosSharedHost.statePath = ${normalizeHostLogicalPath(opts.statePath)};`,
    "}",
    "",
  ].join("\n");
}

export function renderManagedAnchor(managedRoot: string): string {
  const modulePath = path.posix.basename(modulePathFor(managedRoot));
  return ["{ ... }:", "{", "  imports = [", `    ./${modulePath}`, "  ];", "}", ""].join("\n");
}

export function createInstallManifestV1(input: {
  toolFingerprint: string;
  installMode: NixosSharedHostInstallMode;
  configTopology: NixosSharedHostConfigTopology;
  configRoot: string;
  configEntryPath?: string;
  configInjected?: boolean;
  managedRoot: string;
  statePath: string;
  runtimeRoot: string;
  recordsRoot: string;
}): NixosSharedHostInstallManifestV1 {
  const managedRoot = normalizeHostLogicalPath(input.managedRoot);
  const managedDirectories = Array.from(
    new Set(
      [managedRoot, input.runtimeRoot, input.recordsRoot]
        .map((value) => normalizeHostLogicalPath(value))
        .sort(),
    ),
  );
  const managedPaths = Array.from(
    new Set(
      [
        manifestPathFor(managedRoot),
        modulePathFor(managedRoot),
        anchorPathFor(managedRoot),
        normalizeHostLogicalPath(input.statePath),
      ].sort(),
    ),
  );
  return {
    schemaVersion: NIXOS_SHARED_HOST_INSTALL_SCHEMA_V1,
    tool: NIXOS_SHARED_HOST_INSTALL_TOOL,
    toolFingerprint: input.toolFingerprint,
    installMode: input.installMode,
    configTopology: input.configTopology,
    configRoot: normalizeHostLogicalPath(input.configRoot),
    ...(input.configEntryPath
      ? { configEntryPath: normalizeHostLogicalPath(input.configEntryPath) }
      : {}),
    managedRoot,
    statePath: normalizeHostLogicalPath(input.statePath),
    runtimeRoot: normalizeHostLogicalPath(input.runtimeRoot),
    recordsRoot: normalizeHostLogicalPath(input.recordsRoot),
    managedPaths,
    managedDirectories,
    managedUsers: [],
    managedEntryPoints: {
      modulePath: modulePathFor(managedRoot),
      anchorPath: anchorPathFor(managedRoot),
    },
    ...(input.configEntryPath && input.configInjected
      ? { configInjection: { path: normalizeHostLogicalPath(input.configEntryPath) } }
      : {}),
  };
}

export function parseInstallManifest(raw: unknown): NixosSharedHostInstallManifestV1 {
  const parsed = raw as Partial<
    NixosSharedHostInstallManifestV1 & NixosSharedHostInstallManifestV0
  >;
  if (parsed?.schemaVersion === NIXOS_SHARED_HOST_INSTALL_SCHEMA_V1) {
    if (!Array.isArray(parsed.managedPaths) || !Array.isArray(parsed.managedDirectories)) {
      throw new Error("invalid nixos-shared-host install manifest: missing managed path inventory");
    }
    return parsed as NixosSharedHostInstallManifestV1;
  }
  if (parsed?.schemaVersion === NIXOS_SHARED_HOST_INSTALL_SCHEMA_V0) {
    return createInstallManifestV1({
      toolFingerprint: "migrated-from-v0",
      installMode: parsed.installMode || "emit-only",
      configTopology: "plain",
      configRoot: parsed.configRoot || "/etc/nixos",
      managedRoot:
        parsed.managedRoot || legacyDefaultManagedRoot(parsed.configRoot || "/etc/nixos"),
      statePath: parsed.statePath || legacyDefaultStatePath(),
      runtimeRoot: parsed.runtimeRoot || legacyDefaultRuntimeRoot(),
      recordsRoot: parsed.recordsRoot || legacyDefaultRecordsRoot(),
    });
  }
  throw new Error(
    `unsupported nixos-shared-host install manifest schema "${String(parsed?.schemaVersion || "")}"`,
  );
}

export async function readInstallManifest(
  filePath: string,
): Promise<NixosSharedHostInstallManifestV1> {
  return parseInstallManifest(JSON.parse(await fsp.readFile(filePath, "utf8")));
}
