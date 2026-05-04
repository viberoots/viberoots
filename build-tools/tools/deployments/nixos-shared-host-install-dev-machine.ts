#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeJsonDocument } from "./nixos-shared-host-io";
import type { NixosSharedHostClientManifest } from "./nixos-shared-host-install-contract";
import {
  clientManifestPath,
  createClientManifest,
  readClientManifest,
} from "./nixos-shared-host-client-manifest";

export type ClientInput = {
  profileName: string;
  destination: string;
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  sshMode: string;
  sshIdentityFile?: string;
  sshKnownHostsFile?: string;
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
