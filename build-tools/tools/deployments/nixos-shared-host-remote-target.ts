#!/usr/bin/env zx-wrapper
import path from "node:path";
import { sanitizeName } from "../lib/sanitize.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  defaultManagedRoot,
  normalizeHostLogicalPath,
} from "./nixos-shared-host-install-contract.ts";
import {
  readNixosSharedHostClientProfile,
  type ClientInput,
} from "./nixos-shared-host-install-dev-machine.ts";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components.ts";
import type { ReviewedRemoteSshAuth } from "./nixos-shared-host-remote-ssh.ts";
import { serviceClientPlanFromManifest } from "./nixos-shared-host-service-client-config.ts";

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
  remoteExecutionImplemented: true;
  deploymentId: string;
  deploymentLabel: string;
  profileName: string;
  destination: string;
  transportMode: "ssh";
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  remoteArtifactStageRoot: string;
  reviewedRemoteSshAuth?: ReviewedRemoteSshAuth;
  serviceClient: {
    mode: "control-plane-service";
    controlPlaneUrl: string;
    controlPlaneTokenEnv?: string;
  };
  artifactSource: NixosSharedHostRemoteArtifactSource;
  stagedArtifactCleanup: {
    defaultMode: "remove";
    retainFlag: "--retain-remote-artifact";
  };
  hostApply: NixosSharedHostRemoteHostApplyPlan;
  hostApplyExpectedLater: boolean;
};

export type NixosSharedHostRemoteHostApplyMode = "skip" | "switch" | "dry-run";

export type NixosSharedHostRemoteHostApplyPlan = {
  supported: true;
  explicitOptInRequired: true;
  selectedMode: NixosSharedHostRemoteHostApplyMode;
  remoteConfigRoot: string;
  remoteManagedRoot: string;
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

function requireRemotePath(profileName: string, field: RemoteOverrideKey, value: string): string {
  return normalizeHostLogicalPath(requireRemoteValue(profileName, field, value));
}

export function remoteArtifactStageRootFor(remoteRuntimeRoot: string): string {
  return path.posix.join(normalizeHostLogicalPath(remoteRuntimeRoot), ".deploy-artifacts");
}

export function createNixosSharedHostRemoteArtifactPath(
  plan: Pick<NixosSharedHostRemotePlan, "deploymentLabel" | "remoteArtifactStageRoot">,
  executionId: string,
): string {
  return path.posix.join(
    plan.remoteArtifactStageRoot,
    sanitizeName(plan.deploymentLabel),
    sanitizeName(executionId),
  );
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

function hostApplyPlanFor(input?: {
  selectedMode?: NixosSharedHostRemoteHostApplyMode;
  remoteConfigRoot?: string;
  remoteManagedRoot?: string;
}): NixosSharedHostRemoteHostApplyPlan {
  const remoteConfigRoot = normalizeHostLogicalPath(input?.remoteConfigRoot || "/etc/nixos");
  return {
    supported: true,
    explicitOptInRequired: true,
    selectedMode: input?.selectedMode || "skip",
    remoteConfigRoot,
    remoteManagedRoot: normalizeHostLogicalPath(
      input?.remoteManagedRoot || defaultManagedRoot(remoteConfigRoot),
    ),
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
    remoteRepoPath: requireRemotePath(
      profileName,
      "remoteRepoPath",
      overrides.remoteRepoPath ?? manifest.remoteRepoPath,
    ),
    remoteStatePath: requireRemotePath(
      profileName,
      "remoteStatePath",
      overrides.remoteStatePath ?? manifest.remoteStatePath,
    ),
    remoteRuntimeRoot: requireRemotePath(
      profileName,
      "remoteRuntimeRoot",
      overrides.remoteRuntimeRoot ?? manifest.remoteRuntimeRoot,
    ),
    remoteRecordsRoot: requireRemotePath(
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
  hostApply?: {
    selectedMode?: NixosSharedHostRemoteHostApplyMode;
    remoteConfigRoot?: string;
    remoteManagedRoot?: string;
  };
}): Promise<NixosSharedHostRemotePlan> {
  const profileName = String(opts.profileName || "").trim();
  if (!profileName) throw new Error("missing required --profile");
  if (isMultiComponentNixosSharedHostDeployment(opts.deployment)) {
    throw new Error(
      "reviewed nixos-shared-host remote profiles do not support multi-component deployments yet",
    );
  }
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
  const hostApply = hostApplyPlanFor(opts.hostApply);
  return {
    planMode: true,
    remoteExecutionImplemented: true,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    profileName,
    destination: selected.destination,
    transportMode: "ssh",
    remoteRepoPath: selected.remoteRepoPath,
    remoteStatePath: selected.remoteStatePath,
    remoteRuntimeRoot: selected.remoteRuntimeRoot,
    remoteRecordsRoot: selected.remoteRecordsRoot,
    remoteArtifactStageRoot: remoteArtifactStageRootFor(selected.remoteRuntimeRoot),
    ...(profile.manifest.sshAuth
      ? {
          reviewedRemoteSshAuth: {
            identityFile: profile.manifest.sshAuth.identityFile,
            knownHostsFile: profile.manifest.sshAuth.knownHostsFile,
          },
        }
      : {}),
    serviceClient: serviceClientPlanFromManifest(profile.manifest),
    artifactSource: artifactSourceFor(opts.deployment, opts.artifactDir),
    stagedArtifactCleanup: {
      defaultMode: "remove",
      retainFlag: "--retain-remote-artifact",
    },
    hostApply,
    hostApplyExpectedLater: hostApply.selectedMode !== "switch",
  };
}
