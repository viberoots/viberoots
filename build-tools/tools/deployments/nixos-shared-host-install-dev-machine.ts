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
};

function parseClientManifest(raw: unknown, source: string): NixosSharedHostClientManifest {
  const parsed = raw as Partial<NixosSharedHostClientManifest>;
  if (
    parsed?.schemaVersion !== NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1 ||
    parsed.tool !== NIXOS_SHARED_HOST_INSTALL_TOOL ||
    typeof parsed.profileName !== "string" ||
    typeof parsed.destination !== "string" ||
    typeof parsed.remoteRepoPath !== "string" ||
    typeof parsed.remoteStatePath !== "string" ||
    typeof parsed.remoteRuntimeRoot !== "string" ||
    typeof parsed.remoteRecordsRoot !== "string" ||
    typeof parsed.sshMode !== "string" ||
    !Array.isArray(parsed.localManagedPaths)
  ) {
    throw new Error(`${source}: invalid nixos-shared-host client manifest`);
  }
  return parsed as NixosSharedHostClientManifest;
}

function clientManifestPath(outputRoot: string, profileName: string): string {
  return path.resolve(outputRoot, `${requireValue("profileName", profileName)}.json`);
}

async function readClientManifest(filePath: string): Promise<NixosSharedHostClientManifest> {
  return parseClientManifest(JSON.parse(await fsp.readFile(filePath, "utf8")), filePath);
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
  profiles: { manifestPath: string; manifest: NixosSharedHostClientManifest }[];
}> {
  const manifestPaths = await listClientManifestPaths(opts.outputRoot);
  const profiles = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifestPath,
      manifest: await readClientManifest(manifestPath),
    })),
  );
  return { outputRoot: path.resolve(opts.outputRoot), profiles };
}

export async function uninstallNixosSharedHostClient(opts: {
  outputRoot: string;
  profileName?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<{ outputRoot: string; removedProfiles: string[]; removedPaths: string[] }> {
  if (opts.all && opts.profileName) {
    throw new Error("client uninstall accepts either --profile or --all, not both");
  }
  if (!opts.all && !opts.profileName) {
    throw new Error("client uninstall requires --profile <name> or --all");
  }
  const manifestPaths = opts.all
    ? await listClientManifestPaths(opts.outputRoot)
    : [clientManifestPath(opts.outputRoot, String(opts.profileName || ""))];
  const installedProfiles = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifestPath,
      manifest: await readClientManifest(manifestPath),
    })),
  );
  const removedPaths = Array.from(
    new Set(installedProfiles.flatMap(({ manifest }) => manifest.localManagedPaths)),
  ).sort();
  if (!opts.dryRun) {
    await Promise.all(removedPaths.map((managedPath) => fsp.rm(managedPath, { force: true })));
  }
  return {
    outputRoot: path.resolve(opts.outputRoot),
    removedProfiles: installedProfiles.map(({ manifest }) => manifest.profileName).sort(),
    removedPaths,
  };
}
