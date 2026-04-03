#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  readNixosSharedHostClientProfile,
  type ClientInput,
} from "./nixos-shared-host-install-dev-machine.ts";

export type NixosSharedHostRemoteArtifactSource =
  | {
      kind: "component-dist";
      componentTarget: string;
      outputSubdir: "dist";
      remoteTransportRequired: true;
    }
  | {
      kind: "explicit-artifact-dir";
      localArtifactDir: string;
      remoteTransportRequired: true;
    };

export type NixosSharedHostRemotePlan = {
  planMode: true;
  remoteExecutionImplemented: false;
  deploymentId: string;
  deploymentLabel: string;
  profileName: string;
  destination: string;
  transportMode: "ssh";
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  artifactSource: NixosSharedHostRemoteArtifactSource;
  hostApplyExpectedLater: true;
};

type RemoteOverrideKey =
  | "destination"
  | "remoteRepoPath"
  | "remoteStatePath"
  | "remoteRuntimeRoot"
  | "remoteRecordsRoot"
  | "sshMode";

function requireRemoteValue(profileName: string, field: RemoteOverrideKey, value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`profile "${profileName}" has invalid ${field}`);
  }
  return normalized;
}

function artifactSourceFor(
  deployment: NixosSharedHostDeployment,
  artifactDir: string | undefined,
): NixosSharedHostRemoteArtifactSource {
  if (artifactDir) {
    return {
      kind: "explicit-artifact-dir",
      localArtifactDir: path.resolve(artifactDir),
      remoteTransportRequired: true,
    };
  }
  return {
    kind: "component-dist",
    componentTarget: deployment.component.target,
    outputSubdir: "dist",
    remoteTransportRequired: true,
  };
}

function applyRemoteOverrides(
  profileName: string,
  manifest: ClientInput,
  overrides: Partial<ClientInput>,
): ClientInput {
  return {
    profileName,
    destination: requireRemoteValue(
      profileName,
      "destination",
      overrides.destination ?? manifest.destination,
    ),
    remoteRepoPath: requireRemoteValue(
      profileName,
      "remoteRepoPath",
      overrides.remoteRepoPath ?? manifest.remoteRepoPath,
    ),
    remoteStatePath: requireRemoteValue(
      profileName,
      "remoteStatePath",
      overrides.remoteStatePath ?? manifest.remoteStatePath,
    ),
    remoteRuntimeRoot: requireRemoteValue(
      profileName,
      "remoteRuntimeRoot",
      overrides.remoteRuntimeRoot ?? manifest.remoteRuntimeRoot,
    ),
    remoteRecordsRoot: requireRemoteValue(
      profileName,
      "remoteRecordsRoot",
      overrides.remoteRecordsRoot ?? manifest.remoteRecordsRoot,
    ),
    sshMode: requireRemoteValue(profileName, "sshMode", overrides.sshMode ?? manifest.sshMode),
  };
}

export async function createNixosSharedHostRemotePlan(opts: {
  deployment: NixosSharedHostDeployment;
  profileName: string;
  profileRoot: string;
  overrides?: Partial<ClientInput>;
  artifactDir?: string;
}): Promise<NixosSharedHostRemotePlan> {
  const profileName = String(opts.profileName || "").trim();
  if (!profileName) throw new Error("missing required --profile");
  const profileRoot = path.resolve(opts.profileRoot);
  let profile;
  try {
    profile = await readNixosSharedHostClientProfile({
      outputRoot: profileRoot,
      profileName,
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`missing reviewed remote profile "${profileName}" under ${profileRoot}`);
    }
    throw error;
  }
  const selected = applyRemoteOverrides(profileName, profile.manifest, opts.overrides || {});
  if (selected.sshMode !== "ssh") {
    throw new Error(
      `unsupported reviewed transport mode "${selected.sshMode}" for profile "${profileName}"`,
    );
  }
  return {
    planMode: true,
    remoteExecutionImplemented: false,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    profileName,
    destination: selected.destination,
    transportMode: "ssh",
    remoteRepoPath: selected.remoteRepoPath,
    remoteStatePath: selected.remoteStatePath,
    remoteRuntimeRoot: selected.remoteRuntimeRoot,
    remoteRecordsRoot: selected.remoteRecordsRoot,
    artifactSource: artifactSourceFor(opts.deployment, opts.artifactDir),
    hostApplyExpectedLater: true,
  };
}
