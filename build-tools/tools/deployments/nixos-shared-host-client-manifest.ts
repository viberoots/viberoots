#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1,
  NIXOS_SHARED_HOST_INSTALL_TOOL,
  type NixosSharedHostClientManifest,
} from "./nixos-shared-host-install-contract";
import type { ClientInput } from "./nixos-shared-host-install-dev-machine";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireValue(name: keyof ClientInput, value: string): string {
  if (!value.trim()) throw new Error(`missing required client parameter "${name}"`);
  return value.trim();
}

export function parseClientManifest(raw: unknown, source: string): NixosSharedHostClientManifest {
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
    ("sshAuth" in parsed &&
      parsed.sshAuth !== undefined &&
      (!isNonEmptyString(parsed.sshAuth?.identityFile) ||
        !isNonEmptyString(parsed.sshAuth?.knownHostsFile))) ||
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

export function clientManifestPath(outputRoot: string, profileName: string): string {
  return path.resolve(outputRoot, `${requireValue("profileName", profileName)}.json`);
}

export async function readClientManifest(filePath: string): Promise<NixosSharedHostClientManifest> {
  return parseClientManifest(JSON.parse(await fsp.readFile(filePath, "utf8")), filePath);
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
      ...(input.sshIdentityFile?.trim() || input.sshKnownHostsFile?.trim()
        ? {
            sshAuth: {
              identityFile: requireValue("sshIdentityFile", input.sshIdentityFile || ""),
              knownHostsFile: requireValue("sshKnownHostsFile", input.sshKnownHostsFile || ""),
            },
          }
        : {}),
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
