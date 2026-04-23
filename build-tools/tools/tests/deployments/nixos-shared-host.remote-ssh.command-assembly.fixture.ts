#!/usr/bin/env zx-wrapper
import {
  REMOTE_SSH_IDENTITY_FILE_ENV,
  REMOTE_SSH_KNOWN_HOSTS_FILE_ENV,
} from "../../deployments/nixos-shared-host-remote-ssh.ts";
import type { NixosSharedHostRemotePlan } from "../../deployments/nixos-shared-host-remote-target.ts";

export const remoteSshCommandAssemblyPlan: NixosSharedHostRemotePlan = {
  planMode: true,
  remoteExecutionImplemented: true,
  deploymentId: "pleomino-dev",
  deploymentLabel: "//projects/deployments/pleomino-dev:deploy",
  profileName: "mini",
  destination: "mini",
  transportMode: "ssh",
  remoteRepoPath: "/srv/common",
  remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
  remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
  remoteRecordsRoot: "/var/lib/deployment-host/records",
  remoteArtifactStageRoot: "/var/lib/deployment-host/runtime/.deploy-artifacts",
  artifactSource: {
    kind: "explicit-artifact-dir",
    localArtifactDir: "/tmp/local-artifact",
    remoteTransportRequired: true,
  },
  stagedArtifactCleanup: {
    defaultMode: "remove",
    retainFlag: "--retain-remote-artifact",
  },
  hostApply: {
    supported: true,
    explicitOptInRequired: true,
    selectedMode: "skip",
    remoteConfigRoot: "/etc/nixos",
    remoteManagedRoot: "/etc/nixos/deployment-host",
  },
  hostApplyExpectedLater: true,
};

export function withReviewedSshEnv(fn: () => void) {
  const previousIdentity = process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  const previousKnownHosts = process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = "/tmp/jenkins-id";
  process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = "/tmp/known-hosts";
  try {
    fn();
  } finally {
    if (previousIdentity == null) delete process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
    else process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = previousIdentity;
    if (previousKnownHosts == null) delete process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
    else process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = previousKnownHosts;
  }
}
