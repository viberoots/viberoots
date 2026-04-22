#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeJsonDocument } from "./nixos-shared-host-io.ts";
import {
  NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1,
  NIXOS_SHARED_HOST_INSTALL_TOOL,
  type NixosSharedHostClientManifest,
} from "./nixos-shared-host-install-contract.ts";

export type ClientInput = {
  profileName: string;
  destination: string;
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  sshMode: string;
  controlPlaneUrl: string;
  controlPlaneTokenEnv?: string;
};

type ClientProfile = {
  manifestPath: string;
  manifest: NixosSharedHostClientManifest;
};

type InvalidClientProfile = {
  manifestPath: string;
  profileName: string;
  error: string;
};

type ClientProfileReadResult =
  | ({ valid: true } & ClientProfile)
  | ({ valid: false } & InvalidClientProfile);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseClientManifest(raw: unknown, source: string): NixosSharedHostClientManifest {
  const parsed = raw as Partial<NixosSharedHostClientManifest>;
  if (
    parsed?.schemaVersion !== NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1 ||
    parsed.tool !== NIXOS_SHARED_HOST_INSTALL_TOOL ||
    !isNonEmptyString(parsed.profileName) ||
    !isNonEmptyString(parsed.destination) ||
    !isNonEmptyString(parsed.remoteRepoPath) ||
    !isNonEmptyString(parsed.remoteStatePath) ||
    !isNonEmptyString(parsed.remoteRuntimeRoot) ||
    !isNonEmptyString(parsed.remoteRecordsRoot) ||
    !isNonEmptyString(parsed.sshMode) ||
    !isNonEmptyString(parsed.serviceClient?.controlPlaneUrl) ||
    ("controlPlaneTokenEnv" in (parsed.serviceClient || {}) &&
      parsed.serviceClient?.controlPlaneTokenEnv !== undefined &&
      !isNonEmptyString(parsed.serviceClient?.controlPlaneTokenEnv)) ||
    !Array.isArray(parsed.localManagedPaths) ||
    parsed.localManagedPaths.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${source}: invalid nixos-shared-host client manifest`);
  }
  return parsed as NixosSharedHostClientManifest;
}

function clientManifestPath(outputRoot: string, profileName: string): string {
  return path.resolve(outputRoot, `${requireValue("profileName", profileName)}.json`);
}

export async function readClientManifest(filePath: string): Promise<NixosSharedHostClientManifest> {
  return parseClientManifest(JSON.parse(await fsp.readFile(filePath, "utf8")), filePath);
}

async function readClientProfile(manifestPath: string): Promise<ClientProfileReadResult> {
  try {
    return {
      valid: true,
      manifestPath,
      manifest: await readClientManifest(manifestPath),
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") throw error;
    return {
      valid: false,
      manifestPath,
      profileName: path.basename(manifestPath, ".json"),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listClientManifestPaths(outputRoot: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(outputRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.resolve(outputRoot, entry.name))
      .sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function requireValue(name: keyof ClientInput, value: string): string {
  if (!value.trim()) throw new Error(`missing required client parameter "${name}"`);
  return value.trim();
}

export function createClientManifest(input: ClientInput & { toolFingerprint: string }): {
  fileName: string;
  manifest: NixosSharedHostClientManifest;
} {
  const profileName = requireValue("profileName", input.profileName);
  const fileName = `${profileName}.json`;
  return {
    fileName,
    manifest: {
      schemaVersion: NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1,
      tool: NIXOS_SHARED_HOST_INSTALL_TOOL,
      toolFingerprint: input.toolFingerprint,
      profileName,
      destination: requireValue("destination", input.destination),
      remoteRepoPath: requireValue("remoteRepoPath", input.remoteRepoPath),
      remoteStatePath: requireValue("remoteStatePath", input.remoteStatePath),
      remoteRuntimeRoot: requireValue("remoteRuntimeRoot", input.remoteRuntimeRoot),
      remoteRecordsRoot: requireValue("remoteRecordsRoot", input.remoteRecordsRoot),
      sshMode: requireValue("sshMode", input.sshMode),
      serviceClient: {
        controlPlaneUrl: requireValue("controlPlaneUrl", input.controlPlaneUrl),
        ...(input.controlPlaneTokenEnv?.trim()
          ? { controlPlaneTokenEnv: input.controlPlaneTokenEnv.trim() }
          : {}),
      },
      localManagedPaths: [],
    },
  };
}

export async function installNixosSharedHostClient(opts: {
  outputRoot: string;
  toolFingerprint: string;
  input: ClientInput;
  dryRun?: boolean;
}): Promise<{ manifestPath: string; manifest: NixosSharedHostClientManifest }> {
  const { fileName, manifest } = createClientManifest({
    ...opts.input,
    toolFingerprint: opts.toolFingerprint,
  });
  const manifestPath = path.resolve(opts.outputRoot, fileName);
  manifest.localManagedPaths = [manifestPath];
  if (!opts.dryRun) {
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeJsonDocument(manifestPath, manifest);
  }
  return { manifestPath, manifest };
}

export async function listNixosSharedHostClients(opts: { outputRoot: string }): Promise<{
  outputRoot: string;
  profiles: ClientProfile[];
  invalidProfiles: InvalidClientProfile[];
}> {
  const manifestPaths = await listClientManifestPaths(opts.outputRoot);
  const records = await Promise.all(manifestPaths.map(readClientProfile));
  const profiles: ClientProfile[] = [];
  const invalidProfiles: InvalidClientProfile[] = [];
  for (const record of records) {
    if (record.valid) {
      profiles.push({ manifestPath: record.manifestPath, manifest: record.manifest });
      continue;
    }
    invalidProfiles.push({
      manifestPath: record.manifestPath,
      profileName: record.profileName,
      error: record.error,
    });
  }
  return {
    outputRoot: path.resolve(opts.outputRoot),
    profiles,
    invalidProfiles,
  };
}

export async function readNixosSharedHostClientProfile(opts: {
  outputRoot: string;
  profileName: string;
}): Promise<{ manifestPath: string; manifest: NixosSharedHostClientManifest }> {
  const manifestPath = clientManifestPath(opts.outputRoot, opts.profileName);
  return {
    manifestPath,
    manifest: await readClientManifest(manifestPath),
  };
}

export async function uninstallNixosSharedHostClient(opts: {
  outputRoot: string;
  profileName?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<{
  outputRoot: string;
  removedProfiles: string[];
  removedPaths: string[];
  invalidProfiles: InvalidClientProfile[];
}> {
  if (opts.all && opts.profileName) {
    throw new Error("client uninstall accepts either --profile or --all, not both");
  }
  if (!opts.all && !opts.profileName) {
    throw new Error("client uninstall requires --profile <name> or --all");
  }
  const manifestPaths = opts.all
    ? await listClientManifestPaths(opts.outputRoot)
    : [clientManifestPath(opts.outputRoot, String(opts.profileName || ""))];
  const installedProfiles = await Promise.all(manifestPaths.map(readClientProfile));
  const removedProfiles = new Set<string>();
  const removedPaths = new Set<string>();
  const invalidProfiles: InvalidClientProfile[] = [];
  for (const installedProfile of installedProfiles) {
    if (installedProfile.valid) {
      removedProfiles.add(installedProfile.manifest.profileName);
      for (const managedPath of installedProfile.manifest.localManagedPaths) {
        removedPaths.add(managedPath);
      }
      continue;
    }
    invalidProfiles.push({
      manifestPath: installedProfile.manifestPath,
      profileName: installedProfile.profileName,
      error: installedProfile.error,
    });
    removedProfiles.add(installedProfile.profileName);
    removedPaths.add(installedProfile.manifestPath);
  }
  if (!opts.dryRun) {
    await Promise.all(
      Array.from(removedPaths).map((managedPath) => fsp.rm(managedPath, { force: true })),
    );
  }
  return {
    outputRoot: path.resolve(opts.outputRoot),
    removedProfiles: Array.from(removedProfiles).sort(),
    removedPaths: Array.from(removedPaths).sort(),
    invalidProfiles,
  };
}
